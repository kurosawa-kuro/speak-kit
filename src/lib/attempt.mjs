import { createHash, randomUUID } from "node:crypto"
import { gradeDecision, normalizeAnswer } from "./ai/grade.mjs"
import { envelope, validationError } from "./envelope.mjs"
import { hashParts } from "./hash.mjs"
import { query, withTransaction } from "./db.mjs"
import { noteBoundaryMiss, noticeForAttempt } from "./boundary.mjs"
import { DERIVATION, estimateAndDiagnosis } from "./learning.mjs"

const inFlight = new Set()

function dimensionsOf(rubric) {
  const names = rubric?.required_dimensions
  return Array.isArray(names) ? names.filter((name) => typeof name === "string") : []
}

function variantsOf(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "")
}

function recoveryId(attemptId) {
  const bytes = createHash("sha1")
    .update(Buffer.from("6ba7b8129dad11d180b400c04fd430c8", "hex"))
    .update(`skill-trainer-attempt-recovery:${attemptId}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const CONTEXT_COLUMNS = `re.plan_item_id, ed.training_mode, re.prompt, re.expected_reference,
  re.accepted_variants, re.rubric_snapshot, ed.target_skill_id,
  sc.canonical_form, sc.meaning, ed.target_capability, re.modality, re.policy_version`

async function loadContext(exerciseInstanceId) {
  const found = await query(
    `SELECT ${CONTEXT_COLUMNS}
     FROM skill_trainer.rendered_exercises re
     JOIN skill_trainer.exercise_definitions ed
       ON ed.exercise_key = re.exercise_key AND ed.version = re.exercise_version
     JOIN skill_trainer.skill_concepts sc ON sc.id = ed.target_skill_id
     WHERE re.exercise_instance_id = $1`,
    [exerciseInstanceId],
  )
  return found.rows[0] || null
}

async function loadAttemptContext(attemptId) {
  const found = await query(
    `SELECT ${CONTEXT_COLUMNS}, a.actual, a.latency_ms, a.occurred_at
     FROM skill_trainer.training_attempts a
     JOIN skill_trainer.rendered_exercises re ON re.exercise_instance_id = a.exercise_instance_id
     JOIN skill_trainer.exercise_definitions ed
       ON ed.exercise_key = re.exercise_key AND ed.version = re.exercise_version
     JOIN skill_trainer.skill_concepts sc ON sc.id = ed.target_skill_id
     WHERE a.attempt_id = $1`,
    [attemptId],
  )
  return found.rows[0] || null
}

function decide(context, actual) {
  return gradeDecision({
    trainingMode: context.training_mode,
    prompt: context.prompt,
    expectedReference: context.expected_reference,
    acceptedVariants: variantsOf(context.accepted_variants),
    requiredDimensions: dimensionsOf(context.rubric_snapshot),
    canonicalForm: context.canonical_form,
    meaning: context.meaning,
    answer: actual,
  })
}

function deterministicMatch(context, actual) {
  const normalized = normalizeAnswer(actual)
  return [context.expected_reference, ...variantsOf(context.accepted_variants)]
    .some((candidate) => normalizeAnswer(candidate) === normalized)
}

async function completePlanItem(planItemId, keepCompletedAt = false) {
  if (!planItemId) return
  const completedAt = keepCompletedAt ? "COALESCE(completed_at, NOW())" : "NOW()"
  await query(
    `UPDATE skill_trainer.training_plan_items
     SET status = 'completed', completed_at = ${completedAt} WHERE plan_item_id = $1`,
    [planItemId],
  )
  await query(
    `UPDATE skill_trainer.training_plans p
     SET status = 'completed', completed_at = ${completedAt}
     WHERE p.plan_id = (SELECT plan_id FROM skill_trainer.training_plan_items WHERE plan_item_id = $1)
       AND NOT EXISTS (
         SELECT 1 FROM skill_trainer.training_plan_items pi
         WHERE pi.plan_id = p.plan_id AND pi.status <> 'completed'
       )`,
    [planItemId],
  )
}

async function awaitGrade(planItemId) {
  if (!planItemId) return
  await query(
    `UPDATE skill_trainer.training_plan_items SET status = 'awaiting_grade' WHERE plan_item_id = $1`,
    [planItemId],
  )
}

async function insertObservation(attemptId, context, decision, idempotencyKey, adopt) {
  const gradingId = randomUUID()
  const inserted = await query(
    `INSERT INTO skill_trainer.grading_observations
       (grading_id, training_attempt_id, source, observer_version, idempotency_key,
        status, adopted_for_evidence, rubric_version, dimension_results, reason,
        skill_candidates, error_candidates, model_reported_confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '[]'::jsonb, $11, $12)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      gradingId,
      attemptId,
      decision.source,
      decision.observerVersion,
      idempotencyKey,
      decision.status,
      adopt,
      context.rubric_snapshot?.rubric_version || "unknown",
      JSON.stringify(decision.dimensions || {}),
      decision.reason,
      JSON.stringify(decision.errorCause ? [decision.errorCause] : []),
      decision.confidence,
    ],
  )
  return inserted.rowCount ? gradingId : null
}

async function insertEvidence(attemptId, gradingId, context, decision, latencyMs, occurredAt) {
  const evidenceId = randomUUID()
  const outcome = decision.success ? "success" : "failure"
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
  return { evidenceId, outcome }
}

async function commitGrade(attemptId, context, actual, decision, latencyMs, occurredAt) {
  const gradingId = await insertObservation(
    attemptId,
    context,
    decision,
    hashParts([attemptId, decision.source, decision.observerVersion]),
    decision.success != null,
  )
  if (!gradingId) {
    const existing = await existingAttemptResponse(attemptId)
    return {
      gradingId: existing.data.gradingId,
      status: existing.data.gradingStatus || decision.status,
      source: decision.source,
      dimensions: existing.data.dimensions,
      reason: existing.data.reason || "",
      evidenceId: existing.data.evidenceId,
      outcome: existing.data.outcome,
    }
  }
  let evidenceId = null
  let outcome = null
  if (decision.success != null) {
    const derived = await insertEvidence(attemptId, gradingId, context, decision, latencyMs, occurredAt)
    evidenceId = derived.evidenceId
    outcome = derived.outcome
    await completePlanItem(context.plan_item_id)
    await estimateAndDiagnosis(context.target_skill_id, context.target_capability, context.policy_version, true)
  } else {
    await awaitGrade(context.plan_item_id)
  }
  await noteBoundaryMiss(attemptId, context.canonical_form, context.expected_reference, actual)
  return {
    gradingId,
    status: decision.status,
    source: decision.source,
    dimensions: decision.dimensions,
    reason: decision.reason,
    evidenceId,
    outcome,
  }
}

async function existingAttemptResponse(attemptId) {
  const found = await query(
    `SELECT a.exercise_instance_id, a.actual, go.grading_id, go.status AS grading_status,
            go.dimension_results, go.reason, go.evidence_id, go.outcome, re.expected_reference
     FROM skill_trainer.training_attempts a
     LEFT JOIN skill_trainer.rendered_exercises re ON re.exercise_instance_id = a.exercise_instance_id
     LEFT JOIN LATERAL (
       SELECT candidate.grading_id, candidate.status, candidate.dimension_results,
              candidate.reason, effective.evidence_id, effective.outcome
       FROM skill_trainer.grading_observations candidate
       LEFT JOIN skill_trainer.effective_capability_evidence effective
         ON effective.grading_id = candidate.grading_id
       WHERE candidate.training_attempt_id = a.attempt_id
       ORDER BY (effective.evidence_id IS NOT NULL) DESC,
                CASE candidate.source WHEN 'human' THEN 3 WHEN 'deterministic' THEN 2 ELSE 1 END DESC,
                candidate.created_at DESC
       LIMIT 1
     ) go ON true
     WHERE a.attempt_id = $1`,
    [attemptId],
  )
  const row = found.rows[0]
  if (!row) return null
  return envelope(true, "idempotent_replay", {
    attemptId,
    exerciseInstanceId: row.exercise_instance_id,
    actual: row.actual,
    gradingId: row.grading_id,
    gradingStatus: row.grading_status,
    dimensions: row.dimension_results,
    reason: row.reason,
    evidenceId: row.evidence_id,
    outcome: row.outcome,
    expectedReference: row.expected_reference,
    confusion: await noticeForAttempt(attemptId),
  }, null)
}

function pendingEnvelope(attemptId, exerciseInstanceId, actual) {
  return envelope(true, "ok", {
    attemptId,
    exerciseInstanceId,
    actual,
    gradingId: null,
    gradingStatus: "pending",
    graderSource: null,
    reason: null,
    evidenceId: null,
    outcome: null,
  }, null)
}

async function gradeMissingAttempt(attemptId) {
  const context = await loadAttemptContext(attemptId)
  if (!context) return
  const decision = await decide(context, context.actual)
  await commitGrade(attemptId, context, context.actual, decision, context.latency_ms, context.occurred_at)
}

function ensureDeferredGrade(attemptId) {
  if (inFlight.has(attemptId)) return
  inFlight.add(attemptId)
  gradeMissingAttempt(attemptId)
    .catch((error) => console.warn(`deferred grade failed for ${attemptId}: ${error.message}`))
    .finally(() => inFlight.delete(attemptId))
}

async function repairAttemptSideEffects(attemptId) {
  const found = await query(
    `SELECT re.plan_item_id, ed.target_skill_id, ed.target_capability, re.policy_version
     FROM skill_trainer.training_attempts a
     JOIN skill_trainer.rendered_exercises re ON re.exercise_instance_id = a.exercise_instance_id
     JOIN skill_trainer.exercise_definitions ed
       ON ed.exercise_key = re.exercise_key AND ed.version = re.exercise_version
     WHERE a.attempt_id = $1
       AND EXISTS (
         SELECT 1 FROM skill_trainer.effective_capability_evidence ce
         WHERE ce.training_attempt_id = a.attempt_id
       )`,
    [attemptId],
  )
  const row = found.rows[0]
  if (!row) return
  await completePlanItem(row.plan_item_id, true)
  await estimateAndDiagnosis(row.target_skill_id, row.target_capability, row.policy_version, true)
}

function identityMatches(existing, exerciseInstanceId, actual, latencyMs, sessionId, occurredAt) {
  return String(existing.exercise_instance_id) === String(exerciseInstanceId)
    && existing.actual === actual
    && (existing.latency_ms ?? null) === latencyMs
    && (existing.session_id ?? null) === sessionId
    && (occurredAt == null || new Date(existing.occurred_at).getTime() === occurredAt.getTime())
}

async function loadIdentity(attemptId) {
  const found = await query(
    `SELECT exercise_instance_id, actual, latency_ms, session_id, occurred_at
     FROM skill_trainer.training_attempts WHERE attempt_id = $1`,
    [attemptId],
  )
  return found.rows[0] || null
}

const CONFLICT = () => envelope(false, "idempotency_conflict", {}, {
  message: "attempt_id was already used with different immutable input",
})

async function replayExisting(attemptId, deferMissing) {
  const response = await existingAttemptResponse(attemptId)
  if (response.data.gradingId == null) {
    if (deferMissing) {
      ensureDeferredGrade(attemptId)
      return pendingEnvelope(attemptId, response.data.exerciseInstanceId, response.data.actual)
    }
    await gradeMissingAttempt(attemptId)
    return existingAttemptResponse(attemptId)
  }
  if (response.data.gradingStatus === "graded" && response.data.evidenceId == null) {
    return regradeAttempt({ regrade_id: recoveryId(attemptId), attempt_id: attemptId })
  }
  await repairAttemptSideEffects(attemptId)
  return response
}

export async function submitFreeText(request) {
  const attemptId = request.attempt_id
  const exerciseInstanceId = request.exercise_instance_id
  const actual = request.answer_text.trim()
  const latencyMs = Number.isInteger(request.latency_ms) ? request.latency_ms : null
  if (latencyMs != null && (latencyMs < 0 || latencyMs > 2147483647)) {
    return validationError("latency_ms must be between 0 and 2147483647")
  }
  const parsedAt = typeof request.occurred_at === "string" ? new Date(request.occurred_at) : null
  const requestedAt = parsedAt && !Number.isNaN(parsedAt.getTime()) ? parsedAt : null
  const occurredAt = requestedAt || new Date()
  const sessionId = isUuid(request.session_id) ? request.session_id.toLowerCase() : null

  const existing = await loadIdentity(attemptId)
  if (existing) {
    if (!identityMatches(existing, exerciseInstanceId, actual, latencyMs, sessionId, requestedAt)) return CONFLICT()
    return replayExisting(attemptId, false)
  }
  const context = await loadContext(exerciseInstanceId)
  if (!context) return envelope(false, "not_found", {}, { message: "rendered exercise not found" })

  const inserted = await query(
    `INSERT INTO skill_trainer.training_attempts
       (attempt_id, plan_item_id, exercise_id, exercise_instance_id, actual, input_modality,
        latency_ms, session_id, occurred_at)
     VALUES ($1, $2, $3, $3, $4, 'text', $5, $6, $7)
     ON CONFLICT (attempt_id) DO NOTHING`,
    [attemptId, context.plan_item_id, exerciseInstanceId, actual, latencyMs, sessionId, occurredAt],
  )
  if (!inserted.rowCount) {
    const raced = await loadIdentity(attemptId)
    if (!identityMatches(raced, exerciseInstanceId, actual, latencyMs, sessionId, requestedAt)) return CONFLICT()
    return replayExisting(attemptId, true)
  }

  if (context.plan_item_id) {
    await query(
      `UPDATE skill_trainer.training_plan_items SET status = 'in_progress'
       WHERE plan_item_id = $1 AND status = 'planned'`,
      [context.plan_item_id],
    )
  }
  if (request.defer_unknown === true && !deterministicMatch(context, actual)) {
    await awaitGrade(context.plan_item_id)
    ensureDeferredGrade(attemptId)
    return pendingEnvelope(attemptId, exerciseInstanceId, actual)
  }

  const decision = await decide(context, actual)
  const committed = await commitGrade(attemptId, context, actual, decision, latencyMs, occurredAt)
  const confusion = await noticeForAttempt(attemptId)
  const learned = await estimateAndDiagnosis(context.target_skill_id, context.target_capability, context.policy_version, true)
  return envelope(true, "ok", {
    attemptId,
    exerciseInstanceId,
    gradingId: committed.gradingId,
    gradingStatus: committed.status,
    graderSource: committed.source,
    dimensions: committed.dimensions,
    reason: committed.reason,
    evidenceId: committed.evidenceId,
    outcome: committed.outcome,
    expectedReference: context.expected_reference,
    confusion,
    estimate: learned.estimate,
    diagnosis: learned.diagnosis,
  }, null)
}

const SUPPORTED_DIMENSIONS = ["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]

function requiredDimensions(rubric) {
  const names = rubric?.required_dimensions
  if (!Array.isArray(names)) return null
  if (names.some((name) => typeof name !== "string" || !SUPPORTED_DIMENSIONS.includes(name))) return null
  return names
}

function outcomeFromDimensions(status, dimensions, rubric) {
  if (status !== "graded") return null
  const required = requiredDimensions(rubric)
  if (!required) return null
  return required.every((name) => dimensions?.[name] === "pass") ? "success" : "failure"
}

function sameJson(left, right) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    }
    return value
  }
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

export async function recordHumanObservation(request) {
  const observationId = request.observation_id.trim().toLowerCase()
  const attemptId = request.attempt_id.trim().toLowerCase()
  const dimensions = request.dimensions
  const reason = request.reason.trim()
  const observerVersion = typeof request.observer_version === "string" && request.observer_version.trim()
    ? request.observer_version.trim()
    : "human-review-v1"
  const context = await loadAttemptContext(attemptId)
  if (!context) return envelope(false, "not_found", {}, { message: "attempt not found" })
  const required = requiredDimensions(context.rubric_snapshot)
  if (!required) throw new Error("rubric required_dimensions invalid")
  for (const name of required) {
    if (!["pass", "fail"].includes(dimensions[name])) {
      return validationError("every required human dimension must be pass or fail")
    }
  }
  const outcome = outcomeFromDimensions("graded", dimensions, context.rubric_snapshot)
  const rawCause = typeof request.error_cause === "string" ? request.error_cause.trim() : ""
  const errorCause = rawCause || null
  if (errorCause && !["MEANING", "INTENT", "FORM_SELECTION"].includes(errorCause)) {
    return validationError("error_cause must be a grounded allowed cause")
  }
  if (outcome === "success" && errorCause) {
    return validationError("successful human observation must not carry an error_cause")
  }
  const gradingKey = hashParts(["human", observationId])
  const rubricVersion = context.rubric_snapshot?.rubric_version || "unknown"
  const errorCandidates = errorCause ? [errorCause] : []
  const stored = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [attemptId])
    const existing = await client.query(
      `SELECT grading_id, training_attempt_id, adopted_for_evidence,
              observer_version, rubric_version, dimension_results, reason, error_candidates
       FROM skill_trainer.grading_observations WHERE idempotency_key = $1`,
      [gradingKey],
    )
    const prior = existing.rows[0]
    if (prior) {
      if (
        prior.training_attempt_id !== attemptId
        || prior.observer_version !== observerVersion
        || prior.rubric_version !== rubricVersion
        || !sameJson(prior.dimension_results, dimensions)
        || prior.reason !== reason
        || !sameJson(prior.error_candidates, errorCandidates)
      ) {
        return { conflict: true }
      }
      return { replay: prior }
    }
    const gradingId = randomUUID()
    await client.query(
      `INSERT INTO skill_trainer.grading_observations
         (grading_id, training_attempt_id, source, observer_version, idempotency_key,
          status, adopted_for_evidence, rubric_version, dimension_results, reason,
          skill_candidates, error_candidates, model_reported_confidence)
       VALUES ($1, $2, 'human', $3, $4, 'graded', TRUE, $5, $6, $7,
               '[]'::jsonb, $8, NULL)`,
      [gradingId, attemptId, observerVersion, gradingKey, rubricVersion, JSON.stringify(dimensions), reason, JSON.stringify(errorCandidates)],
    )
    const evidenceId = randomUUID()
    await client.query(
      `INSERT INTO skill_trainer.capability_evidence
         (evidence_id, training_attempt_id, grading_id, skill_id, capability, modality,
          outcome, latency_ms, error_cause, evidence_confidence,
          derivation_version, policy_version, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 100, $10, $11, $12)`,
      [
        evidenceId, attemptId, gradingId, context.target_skill_id, context.target_capability,
        context.modality, outcome, context.latency_ms, errorCause, DERIVATION,
        context.policy_version, context.occurred_at,
      ],
    )
    if (context.plan_item_id) {
      await client.query(
        `UPDATE skill_trainer.training_plan_items
         SET status = 'completed', completed_at = COALESCE(completed_at, NOW())
         WHERE plan_item_id = $1`,
        [context.plan_item_id],
      )
      await client.query(
        `UPDATE skill_trainer.training_plans p
         SET status = 'completed', completed_at = COALESCE(completed_at, NOW())
         WHERE p.plan_id = (SELECT plan_id FROM skill_trainer.training_plan_items WHERE plan_item_id = $1)
           AND NOT EXISTS (
             SELECT 1 FROM skill_trainer.training_plan_items pi
             WHERE pi.plan_id = p.plan_id AND pi.status <> 'completed'
           )`,
        [context.plan_item_id],
      )
    }
    return { gradingId, evidenceId }
  })
  if (stored.conflict) {
    return envelope(false, "idempotency_conflict", {}, { message: "observation_id was already used with different immutable input" })
  }
  if (stored.replay) {
    return envelope(true, "idempotent_replay", {
      observationId,
      attemptId,
      gradingId: stored.replay.grading_id,
      outcome: outcomeFromDimensions("graded", stored.replay.dimension_results, context.rubric_snapshot),
      adoptedForEvidence: stored.replay.adopted_for_evidence,
    }, null)
  }
  const learned = await estimateAndDiagnosis(context.target_skill_id, context.target_capability, context.policy_version, true)
  return envelope(true, "ok", {
    observationId,
    attemptId,
    gradingId: stored.gradingId,
    observerVersion,
    outcome,
    adoptedForEvidence: true,
    evidenceId: stored.evidenceId,
    estimate: learned.estimate,
    diagnosis: learned.diagnosis,
  }, null)
}

export async function compareObservations(request) {
  const attemptId = request.attempt_id.trim().toLowerCase()
  const rubric = await query(
    `SELECT re.rubric_snapshot
     FROM skill_trainer.training_attempts a
     JOIN skill_trainer.rendered_exercises re ON re.exercise_instance_id = a.exercise_instance_id
     WHERE a.attempt_id = $1`,
    [attemptId],
  )
  if (!rubric.rows[0]) return envelope(false, "not_found", {}, { message: "attempt not found" })
  const rows = await query(
    `SELECT grading_id, source, observer_version, status, dimension_results, reason,
            adopted_for_evidence, created_at
     FROM skill_trainer.grading_observations
     WHERE training_attempt_id = $1 ORDER BY created_at, grading_id`,
    [attemptId],
  )
  const outcomes = new Set()
  const observations = rows.rows.map((row) => {
    const outcome = outcomeFromDimensions(row.status, row.dimension_results, rubric.rows[0].rubric_snapshot)
    if (outcome) outcomes.add(outcome)
    return {
      gradingId: row.grading_id,
      source: row.source,
      observerVersion: row.observer_version,
      status: row.status,
      dimensions: row.dimension_results,
      reason: row.reason,
      adoptedForEvidence: row.adopted_for_evidence,
      outcome,
      createdAt: row.created_at,
    }
  })
  return envelope(true, "ok", {
    attemptId,
    observationCount: observations.length,
    hasOutcomeDisagreement: outcomes.size > 1,
    observations,
  }, null)
}

export async function regradeAttempt(request) {
  const context = await loadAttemptContext(request.attempt_id)
  if (!context) return envelope(false, "not_found", {}, { message: "attempt not found" })
  const attemptId = request.attempt_id
  const regradeId = request.regrade_id
  const decision = await decide(context, context.actual)
  const gradingKey = hashParts(["regrade", attemptId, regradeId, decision.source, decision.observerVersion])

  const replay = await query(
    `SELECT go.grading_id, go.status, go.source, go.observer_version, go.dimension_results,
            go.reason, go.adopted_for_evidence, ce.evidence_id
     FROM skill_trainer.grading_observations go
     LEFT JOIN skill_trainer.capability_evidence ce ON ce.grading_id = go.grading_id
     WHERE go.idempotency_key = $1`,
    [gradingKey],
  )
  const prior = replay.rows[0]
  if (prior) {
    const learned = await estimateAndDiagnosis(
      context.target_skill_id,
      context.target_capability,
      context.policy_version,
      prior.adopted_for_evidence && prior.evidence_id != null,
    )
    return envelope(true, "idempotent_replay", {
      regradeId,
      attemptId,
      gradingId: prior.grading_id,
      gradingStatus: prior.status,
      graderSource: prior.source,
      observerVersion: prior.observer_version,
      dimensions: prior.dimension_results,
      reason: prior.reason,
      adoptedForEvidence: prior.adopted_for_evidence,
      evidenceId: prior.evidence_id,
      outcome: outcomeFromDimensions(prior.status, prior.dimension_results, context.rubric_snapshot),
      expectedReference: context.expected_reference,
      estimate: learned.estimate,
      diagnosis: learned.diagnosis,
    }, null)
  }

  const adopt = decision.success != null
  const result = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [attemptId])
    const gradingId = randomUUID()
    await client.query(
      `INSERT INTO skill_trainer.grading_observations
         (grading_id, training_attempt_id, source, observer_version, idempotency_key,
          status, adopted_for_evidence, rubric_version, dimension_results, reason,
          skill_candidates, error_candidates, model_reported_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '[]'::jsonb, $11, $12)`,
      [
        gradingId,
        attemptId,
        decision.source,
        decision.observerVersion,
        gradingKey,
        decision.status,
        adopt,
        context.rubric_snapshot?.rubric_version || "unknown",
        JSON.stringify(decision.dimensions || {}),
        decision.reason,
        JSON.stringify(decision.errorCause ? [decision.errorCause] : []),
        decision.confidence,
      ],
    )
    let evidenceId = null
    if (adopt) {
      evidenceId = randomUUID()
      await client.query(
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
          decision.success ? "success" : "failure",
          context.latency_ms,
          decision.errorCause,
          decision.source === "deterministic" ? 100 : 80,
          DERIVATION,
          context.policy_version,
          context.occurred_at,
        ],
      )
    }
    return { gradingId, evidenceId }
  })
  if (adopt) await completePlanItem(context.plan_item_id)
  const learned = await estimateAndDiagnosis(context.target_skill_id, context.target_capability, context.policy_version, adopt)
  return envelope(true, "ok", {
    regradeId,
    attemptId,
    gradingId: result.gradingId,
    gradingStatus: decision.status,
    graderSource: decision.source,
    observerVersion: decision.observerVersion,
    dimensions: decision.dimensions,
    reason: decision.reason,
    adoptedForEvidence: adopt,
    evidenceId: result.evidenceId,
    outcome: adopt ? (decision.success ? "success" : "failure") : null,
    expectedReference: context.expected_reference,
    estimate: learned.estimate,
    diagnosis: learned.diagnosis,
  }, null)
}
