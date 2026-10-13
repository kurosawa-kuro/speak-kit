import { randomUUID } from "node:crypto"
import { gradeDecision } from "../ai/grade.mjs"
import { normalizeAnswer } from "../domain/normalize.mjs"
import { hashParts } from "../domain/hash.mjs"
import { verdictFields } from "../domain/verdict.mjs"
import { envelope, validationError } from "../http/envelope.mjs"
import { logError } from "../http/errors.mjs"
import { query, withTransaction } from "../db.mjs"
import { noteBoundaryMiss, noticeForAttempt } from "./boundary.mjs"
import { DERIVATION, estimateAndDiagnosis } from "./learning.mjs"

// 1 つの回答の書き込み（回答・採点・証拠・計画の完了・診断・混同の記録）は、1 つのトランザクションに入れる。
// AI の採点はトランザクションの外で先に済ませる。後回しにした採点は grading_claims で二重に走らせない。

/** 回答の応答。verdict と canRegrade を足す。 */
function gradedEnvelope(code, data) {
  return envelope(true, code, { ...data, ...verdictFields(data.gradingStatus, data.outcome) }, null)
}

const SUPPORTED_DIMENSIONS = ["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]
const CLAIM_STALE = "2 minutes"

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

function decide(operation, context, actual) {
  return gradeDecision({
    trainingMode: context.training_mode,
    prompt: context.prompt,
    expectedReference: context.expected_reference,
    acceptedVariants: variantsOf(context.accepted_variants),
    requiredDimensions: dimensionsOf(context.rubric_snapshot),
    canonicalForm: context.canonical_form,
    meaning: context.meaning,
    answer: actual,
  }, operation)
}

function deterministicMatch(context, actual) {
  const normalized = normalizeAnswer(actual)
  return [context.expected_reference, ...variantsOf(context.accepted_variants)]
    .some((candidate) => normalizeAnswer(candidate) === normalized)
}

async function completePlanItem(db, planItemId) {
  if (!planItemId) return
  await db.query(
    `UPDATE skill_trainer.training_plan_items
     SET status = 'completed', completed_at = COALESCE(completed_at, NOW()) WHERE plan_item_id = $1`,
    [planItemId],
  )
  await db.query(
    `UPDATE skill_trainer.training_plans p
     SET status = 'completed', completed_at = COALESCE(completed_at, NOW())
     WHERE p.plan_id = (SELECT plan_id FROM skill_trainer.training_plan_items WHERE plan_item_id = $1)
       AND NOT EXISTS (
         SELECT 1 FROM skill_trainer.training_plan_items pi
         WHERE pi.plan_id = p.plan_id AND pi.status <> 'completed'
       )`,
    [planItemId],
  )
}

async function setPlanItemStatus(db, planItemId, status, from) {
  if (!planItemId) return
  await db.query(
    `UPDATE skill_trainer.training_plan_items SET status = $2
     WHERE plan_item_id = $1 AND ($3::text IS NULL OR status = $3)`,
    [planItemId, status, from ?? null],
  )
}

async function insertObservation(db, learnerKey, attemptId, context, decision, idempotencyKey, adopt) {
  const gradingId = randomUUID()
  const inserted = await db.query(
    `INSERT INTO skill_trainer.grading_observations
       (grading_id, learner_key, training_attempt_id, source, observer_version, idempotency_key,
        status, adopted_for_evidence, rubric_version, dimension_results, reason,
        skill_candidates, error_candidates, model_reported_confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '[]'::jsonb, $12, $13)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      gradingId,
      learnerKey,
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

async function insertEvidence(db, learnerKey, attemptId, gradingId, context, evidence) {
  const evidenceId = randomUUID()
  await db.query(
    `INSERT INTO skill_trainer.capability_evidence
       (evidence_id, learner_key, training_attempt_id, grading_id, skill_id, capability, modality,
        outcome, latency_ms, error_cause, evidence_confidence,
        derivation_version, policy_version, observed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      evidenceId,
      learnerKey,
      attemptId,
      gradingId,
      context.target_skill_id,
      context.target_capability,
      context.modality,
      evidence.outcome,
      evidence.latencyMs,
      evidence.errorCause,
      evidence.confidence,
      DERIVATION,
      context.policy_version,
      evidence.occurredAt,
    ],
  )
  return evidenceId
}

/** 採点を書き込む。同じ採点がすでにあれば何もしないで null を返す。 */
async function commitGrade(db, learnerKey, attemptId, context, actual, decision, latencyMs, occurredAt) {
  const adopt = decision.success != null
  const gradingId = await insertObservation(
    db,
    learnerKey,
    attemptId,
    context,
    decision,
    hashParts([attemptId, decision.source, decision.observerVersion]),
    adopt,
  )
  if (!gradingId) return null
  let evidenceId = null
  let outcome = null
  if (adopt) {
    outcome = decision.success ? "success" : "failure"
    evidenceId = await insertEvidence(db, learnerKey, attemptId, gradingId, context, {
      outcome,
      latencyMs,
      errorCause: decision.errorCause,
      confidence: decision.source === "deterministic" ? 100 : 80,
      occurredAt,
    })
    await completePlanItem(db, context.plan_item_id)
  } else {
    await setPlanItemStatus(db, context.plan_item_id, "awaiting_grade")
  }
  await noteBoundaryMiss(attemptId, context.canonical_form, context.expected_reference, actual, db)
  await db.query("DELETE FROM skill_trainer.grading_claims WHERE attempt_id = $1", [attemptId])
  const learned = await estimateAndDiagnosis(context.target_skill_id, context.target_capability, context.policy_version, true, db)
  return { gradingId, status: decision.status, source: decision.source, dimensions: decision.dimensions, reason: decision.reason, evidenceId, outcome, learned }
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
  return gradedEnvelope("idempotent_replay", {
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
  })
}

function pendingEnvelope(attemptId, exerciseInstanceId, actual) {
  return gradedEnvelope("ok", {
    attemptId,
    exerciseInstanceId,
    actual,
    gradingId: null,
    gradingStatus: "pending",
    graderSource: null,
    reason: null,
    evidenceId: null,
    outcome: null,
  })
}

/** 後回しの採点を引き受ける。ほかが進めている間（2 分以内）は false。 */
async function claimGrading(db, attemptId) {
  const claimed = await db.query(
    `INSERT INTO skill_trainer.grading_claims (attempt_id) VALUES ($1)
     ON CONFLICT (attempt_id) DO UPDATE SET claimed_at = NOW()
       WHERE skill_trainer.grading_claims.claimed_at < NOW() - interval '${CLAIM_STALE}'
     RETURNING attempt_id`,
    [attemptId],
  )
  return claimed.rowCount > 0
}

async function gradeDeferred(operation, attemptId) {
  const context = await loadAttemptContext(attemptId)
  if (!context) return
  const decision = await decide(operation, context, context.actual)
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [attemptId])
    const graded = await client.query(
      "SELECT 1 FROM skill_trainer.grading_observations WHERE training_attempt_id = $1 LIMIT 1",
      [attemptId],
    )
    if (graded.rowCount) {
      await client.query("DELETE FROM skill_trainer.grading_claims WHERE attempt_id = $1", [attemptId])
      return
    }
    await commitGrade(client, operation.learnerKey, attemptId, context, context.actual, decision, context.latency_ms, context.occurred_at)
  })
}

function deferGrading(operation, attemptId) {
  operation.defer(() => gradeDeferred(operation, attemptId)
    .catch((error) => logError(`deferred grade ${attemptId}`, error)))
}

async function replayExisting(operation, attemptId) {
  const response = await existingAttemptResponse(attemptId)
  if (response.data.gradingId == null) {
    if (await claimGrading({ query }, attemptId)) deferGrading(operation, attemptId)
    return pendingEnvelope(attemptId, response.data.exerciseInstanceId, response.data.actual)
  }
  return response
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

async function insertAttempt(db, learnerKey, attempt, context) {
  const inserted = await db.query(
    `INSERT INTO skill_trainer.training_attempts
       (attempt_id, learner_key, plan_item_id, exercise_id, exercise_instance_id, actual, input_modality,
        latency_ms, session_id, occurred_at)
     VALUES ($1, $2, $3, $4, $4, $5, 'text', $6, $7, $8)
     ON CONFLICT (attempt_id) DO NOTHING`,
    [attempt.attemptId, learnerKey, context.plan_item_id, attempt.exerciseInstanceId, attempt.actual, attempt.latencyMs, attempt.sessionId, attempt.occurredAt],
  )
  if (inserted.rowCount) await setPlanItemStatus(db, context.plan_item_id, "in_progress", "planned")
  return inserted.rowCount > 0
}

export async function submitFreeText(operation, request) {
  const latencyMs = Number.isInteger(request.latency_ms) ? request.latency_ms : null
  if (latencyMs != null && (latencyMs < 0 || latencyMs > 2147483647)) {
    return validationError("latency_ms must be between 0 and 2147483647")
  }
  const parsedAt = typeof request.occurred_at === "string" ? new Date(request.occurred_at) : null
  const requestedAt = parsedAt && !Number.isNaN(parsedAt.getTime()) ? parsedAt : null
  const attempt = {
    attemptId: request.attempt_id,
    exerciseInstanceId: request.exercise_instance_id,
    actual: request.answer_text.trim(),
    latencyMs,
    sessionId: isUuid(request.session_id) ? request.session_id.toLowerCase() : null,
    occurredAt: requestedAt || new Date(),
  }
  const replayIfSame = async () => {
    const existing = await loadIdentity(attempt.attemptId)
    if (!identityMatches(existing, attempt.exerciseInstanceId, attempt.actual, latencyMs, attempt.sessionId, requestedAt)) return CONFLICT()
    return replayExisting(operation, attempt.attemptId)
  }
  if (await loadIdentity(attempt.attemptId)) return replayIfSame()
  const context = await loadContext(attempt.exerciseInstanceId)
  if (!context) return envelope(false, "not_found", {}, { message: "rendered exercise not found" })

  if (request.defer_unknown === true && !deterministicMatch(context, attempt.actual)) {
    const accepted = await withTransaction(async (client) => {
      if (!(await insertAttempt(client, operation.learnerKey, attempt, context))) return false
      await setPlanItemStatus(client, context.plan_item_id, "awaiting_grade")
      await claimGrading(client, attempt.attemptId)
      return true
    })
    if (!accepted) return replayIfSame()
    deferGrading(operation, attempt.attemptId)
    return pendingEnvelope(attempt.attemptId, attempt.exerciseInstanceId, attempt.actual)
  }

  const decision = await decide(operation, context, attempt.actual)
  const committed = await withTransaction(async (client) => {
    if (!(await insertAttempt(client, operation.learnerKey, attempt, context))) return null
    return commitGrade(client, operation.learnerKey, attempt.attemptId, context, attempt.actual, decision, latencyMs, attempt.occurredAt)
  })
  if (!committed) return replayIfSame()
  return gradedEnvelope("ok", {
    attemptId: attempt.attemptId,
    exerciseInstanceId: attempt.exerciseInstanceId,
    gradingId: committed.gradingId,
    gradingStatus: committed.status,
    graderSource: committed.source,
    dimensions: committed.dimensions,
    reason: committed.reason,
    evidenceId: committed.evidenceId,
    outcome: committed.outcome,
    expectedReference: context.expected_reference,
    confusion: await noticeForAttempt(attempt.attemptId),
    estimate: committed.learned.estimate,
    diagnosis: committed.learned.diagnosis,
  })
}

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

export async function recordHumanObservation(operation, request) {
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
         (grading_id, learner_key, training_attempt_id, source, observer_version, idempotency_key,
          status, adopted_for_evidence, rubric_version, dimension_results, reason,
          skill_candidates, error_candidates, model_reported_confidence)
       VALUES ($1, $2, $3, 'human', $4, $5, 'graded', TRUE, $6, $7, $8,
               '[]'::jsonb, $9, NULL)`,
      [gradingId, operation.learnerKey, attemptId, observerVersion, gradingKey, rubricVersion, JSON.stringify(dimensions), reason, JSON.stringify(errorCandidates)],
    )
    const evidenceId = await insertEvidence(client, operation.learnerKey, attemptId, gradingId, context, {
      outcome,
      latencyMs: context.latency_ms,
      errorCause,
      confidence: 100,
      occurredAt: context.occurred_at,
    })
    await completePlanItem(client, context.plan_item_id)
    const learned = await estimateAndDiagnosis(context.target_skill_id, context.target_capability, context.policy_version, true, client)
    return { gradingId, evidenceId, learned }
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
  return envelope(true, "ok", {
    observationId,
    attemptId,
    gradingId: stored.gradingId,
    observerVersion,
    outcome,
    adoptedForEvidence: true,
    evidenceId: stored.evidenceId,
    estimate: stored.learned.estimate,
    diagnosis: stored.learned.diagnosis,
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

async function regradeReplay(db, gradingKey) {
  const replay = await db.query(
    `SELECT go.grading_id, go.status, go.source, go.observer_version, go.dimension_results,
            go.reason, go.adopted_for_evidence, ce.evidence_id
     FROM skill_trainer.grading_observations go
     LEFT JOIN skill_trainer.capability_evidence ce ON ce.grading_id = go.grading_id
     WHERE go.idempotency_key = $1`,
    [gradingKey],
  )
  return replay.rows[0] ?? null
}

async function regradeReplayEnvelope(context, regradeId, attemptId, prior) {
  const learned = await estimateAndDiagnosis(
    context.target_skill_id,
    context.target_capability,
    context.policy_version,
    prior.adopted_for_evidence && prior.evidence_id != null,
  )
  return gradedEnvelope("idempotent_replay", {
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
  })
}

export async function regradeAttempt(operation, request) {
  const context = await loadAttemptContext(request.attempt_id)
  if (!context) return envelope(false, "not_found", {}, { message: "attempt not found" })
  const attemptId = request.attempt_id
  const regradeId = request.regrade_id
  // 再送の確認は AI を呼ぶ前に行う。鍵に採点の結果（source など）を入れると、AI を呼ぶまで再送か分からない。
  const gradingKey = hashParts(["regrade", attemptId, regradeId])
  const prior = await regradeReplay({ query }, gradingKey)
  if (prior) return regradeReplayEnvelope(context, regradeId, attemptId, prior)

  const decision = await decide(operation, context, context.actual)
  const adopt = decision.success != null
  const result = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [attemptId])
    const raced = await regradeReplay(client, gradingKey)
    if (raced) return { raced }
    const gradingId = await insertObservation(client, operation.learnerKey, attemptId, context, decision, gradingKey, adopt)
    let evidenceId = null
    if (adopt) {
      evidenceId = await insertEvidence(client, operation.learnerKey, attemptId, gradingId, context, {
        outcome: decision.success ? "success" : "failure",
        latencyMs: context.latency_ms,
        errorCause: decision.errorCause,
        confidence: decision.source === "deterministic" ? 100 : 80,
        occurredAt: context.occurred_at,
      })
      await completePlanItem(client, context.plan_item_id)
    }
    const learned = await estimateAndDiagnosis(context.target_skill_id, context.target_capability, context.policy_version, adopt, client)
    return { gradingId, evidenceId, learned }
  })
  if (result.raced) return regradeReplayEnvelope(context, regradeId, attemptId, result.raced)
  return gradedEnvelope("ok", {
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
    estimate: result.learned.estimate,
    diagnosis: result.learned.diagnosis,
  })
}
