import { randomUUID } from "node:crypto"
import { gradeDecision } from "./ai/grade.mjs"
import { envelope } from "./envelope.mjs"
import { hashParts } from "./hash.mjs"
import { query } from "./db.mjs"

const DERIVATION = "phase1-capability-evidence-v3"

function dimensionsOf(rubric) {
  const names = rubric?.required_dimensions
  return Array.isArray(names) ? names.filter((name) => typeof name === "string") : []
}

function variantsOf(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []
}

async function loadContext(exerciseInstanceId) {
  const found = await query(
    `SELECT re.plan_item_id, ed.training_mode, re.prompt, re.expected_reference,
            re.accepted_variants, re.rubric_snapshot, ed.target_skill_id,
            sc.canonical_form, sc.meaning, ed.target_capability, re.modality, re.policy_version
     FROM skill_trainer.rendered_exercises re
     JOIN skill_trainer.exercise_definitions ed
       ON ed.exercise_key = re.exercise_key AND ed.version = re.exercise_version
     JOIN skill_trainer.skill_concepts sc ON sc.id = ed.target_skill_id
     WHERE re.exercise_instance_id = $1`,
    [exerciseInstanceId],
  )
  return found.rows[0] || null
}

async function finishPlan(planItemId, graded) {
  if (!planItemId) return
  if (graded) {
    await query(
      `UPDATE skill_trainer.training_plan_items
       SET status = 'completed', completed_at = NOW() WHERE plan_item_id = $1`,
      [planItemId],
    )
    await query(
      `UPDATE skill_trainer.training_plans p
       SET status = 'completed', completed_at = NOW()
       WHERE p.plan_id = (SELECT plan_id FROM skill_trainer.training_plan_items WHERE plan_item_id = $1)
         AND NOT EXISTS (
           SELECT 1 FROM skill_trainer.training_plan_items pi
           WHERE pi.plan_id = p.plan_id AND pi.status <> 'completed'
         )`,
      [planItemId],
    )
    return
  }
  await query(
    `UPDATE skill_trainer.training_plan_items SET status = 'awaiting_grade' WHERE plan_item_id = $1`,
    [planItemId],
  )
}

async function commitDecision(attemptId, context, decision, latencyMs, occurredAt, keyParts) {
  const gradingId = randomUUID()
  const inserted = await query(
    `INSERT INTO skill_trainer.grading_observations
       (grading_id, training_attempt_id, source, observer_version, idempotency_key,
        status, adopted_for_evidence, rubric_version, dimension_results, reason,
        skill_candidates, error_candidates, model_reported_confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '[]'::jsonb, $11, $12)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING grading_id`,
    [
      gradingId,
      attemptId,
      decision.source,
      decision.observerVersion,
      hashParts(keyParts),
      decision.status,
      decision.success != null,
      context.rubric_snapshot?.rubric_version || "unknown",
      JSON.stringify(decision.dimensions || {}),
      decision.reason,
      JSON.stringify(decision.errorCause ? [decision.errorCause] : []),
      decision.confidence,
    ],
  )
  if (!inserted.rows[0]) return null
  let evidenceId = null
  let outcome = null
  if (decision.success != null) {
    evidenceId = randomUUID()
    outcome = decision.success ? "success" : "failure"
    await query(
      `INSERT INTO skill_trainer.capability_evidence
         (evidence_id, training_attempt_id, grading_id, skill_id, capability, modality,
          outcome, latency_ms, error_cause, evidence_confidence,
          derivation_version, policy_version, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        evidenceId,
        attemptId,
        gradingId,
        context.target_skill_id,
        context.target_capability,
        context.modality,
        outcome,
        latencyMs,
        decision.errorCause,
        decision.source === "deterministic" ? 100 : 80,
        DERIVATION,
        context.policy_version,
        occurredAt,
      ],
    )
  }
  await finishPlan(context.plan_item_id, decision.success != null)
  return { gradingId, evidenceId, outcome }
}

export async function submitFreeText(request) {
  const attemptId = request.attempt_id
  const exerciseInstanceId = request.exercise_instance_id
  const actual = request.answer_text.trim()
  const latencyMs = Number.isInteger(request.latency_ms) ? request.latency_ms : null
  const existing = await query(
    `SELECT a.actual, go.grading_id, go.status, go.reason, ce.evidence_id, ce.outcome
     FROM skill_trainer.training_attempts a
     LEFT JOIN skill_trainer.grading_observations go ON go.training_attempt_id = a.attempt_id
     LEFT JOIN skill_trainer.capability_evidence ce ON ce.grading_id = go.grading_id
     WHERE a.attempt_id = $1
     ORDER BY go.created_at DESC NULLS LAST
     LIMIT 1`,
    [attemptId],
  )
  if (existing.rows[0]) {
    const row = existing.rows[0]
    if (row.actual !== actual) {
      return envelope(false, "idempotency_conflict", {}, { message: "attempt_id was already used with different immutable input" })
    }
    return envelope(true, "ok", {
      attemptId,
      exerciseInstanceId,
      gradingId: row.grading_id,
      gradingStatus: row.status,
      reason: row.reason,
      evidenceId: row.evidence_id,
      outcome: row.outcome,
    }, null)
  }
  const context = await loadContext(exerciseInstanceId)
  if (!context) {
    return envelope(false, "not_found", {}, { message: "rendered exercise not found" })
  }
  if (context.plan_item_id) {
    await query(
      `UPDATE skill_trainer.training_plan_items SET status = 'in_progress'
       WHERE plan_item_id = $1 AND status = 'planned'`,
      [context.plan_item_id],
    )
  }
  const occurredAt = new Date()
  await query(
    `INSERT INTO skill_trainer.training_attempts
       (attempt_id, plan_item_id, exercise_id, exercise_instance_id, actual, input_modality,
        latency_ms, occurred_at)
     VALUES ($1, $2, $3, $3, $4, 'text', $5, $6)`,
    [attemptId, context.plan_item_id, exerciseInstanceId, actual, latencyMs, occurredAt],
  )
  const decision = await gradeDecision({
    trainingMode: context.training_mode,
    prompt: context.prompt,
    expectedReference: context.expected_reference,
    acceptedVariants: variantsOf(context.accepted_variants),
    requiredDimensions: dimensionsOf(context.rubric_snapshot),
    canonicalForm: context.canonical_form,
    meaning: context.meaning,
    answer: actual,
  })
  const committed = await commitDecision(attemptId, context, decision, latencyMs, occurredAt, [
    attemptId,
    decision.source,
    decision.observerVersion,
  ])
  return envelope(true, "ok", {
    attemptId,
    exerciseInstanceId,
    gradingId: committed?.gradingId || null,
    gradingStatus: decision.status,
    graderSource: decision.source,
    reason: decision.reason,
    evidenceId: committed?.evidenceId || null,
    outcome: committed?.outcome || null,
    expectedReference: context.expected_reference,
  }, null)
}

export async function regradeAttempt(request) {
  const found = await query(
    `SELECT a.attempt_id, a.actual, a.latency_ms, a.occurred_at, a.exercise_instance_id
     FROM skill_trainer.training_attempts a
     WHERE a.attempt_id = $1 AND a.response_mode = 'free_text'`,
    [request.attempt_id],
  )
  const attempt = found.rows[0]
  if (!attempt) return envelope(false, "not_found", {}, { message: "attempt not found" })
  const context = await loadContext(attempt.exercise_instance_id)
  if (!context) return envelope(false, "not_found", {}, { message: "rendered exercise not found" })
  const decision = await gradeDecision({
    trainingMode: context.training_mode,
    prompt: context.prompt,
    expectedReference: context.expected_reference,
    acceptedVariants: variantsOf(context.accepted_variants),
    requiredDimensions: dimensionsOf(context.rubric_snapshot),
    canonicalForm: context.canonical_form,
    meaning: context.meaning,
    answer: attempt.actual,
  })
  const committed = await commitDecision(attempt.attempt_id, context, decision, attempt.latency_ms, attempt.occurred_at, [
    attempt.attempt_id,
    decision.source,
    decision.observerVersion,
    request.regrade_id,
  ])
  return envelope(true, "ok", {
    attemptId: attempt.attempt_id,
    regradeId: request.regrade_id,
    gradingId: committed?.gradingId || null,
    gradingStatus: decision.status,
    reason: decision.reason,
    evidenceId: committed?.evidenceId || null,
    outcome: committed?.outcome || null,
    expectedReference: context.expected_reference,
  }, null)
}
