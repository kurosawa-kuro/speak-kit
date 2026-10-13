import { query } from "./db.mjs"

export const ESTIMATOR = "capability-estimator-v1"
export const DIAGNOSIS_RULE = "phase1-capability-diagnosis-v3"
export const DERIVATION = "phase1-capability-evidence-v3"
export const EVIDENCE_SELECTION = "effective-evidence-human-deterministic-ai-v1"

export async function loadPolicy(version = null, db = { query }) {
  const found = version
    ? await db.query(
      `SELECT policy_version, config FROM skill_trainer.learning_policy_versions WHERE policy_version = $1`,
      [version],
    )
    : await db.query(
      `SELECT policy_version, config FROM skill_trainer.learning_policy_versions
       WHERE status = 'active' ORDER BY effective_at DESC LIMIT 1`,
    )
  const row = found.rows[0]
  if (!row) throw new Error("adaptive learning policy not found")
  const config = row.config || {}
  return {
    version: row.policy_version,
    config: {
      ...config,
      evidence_window_days: Number(config.evidence_window_days || 30),
      min_graded_count: Number(config.min_graded_count || 3),
      target_success_rate: Number(config.target_success_rate || 0.8),
      target_p50_latency_ms: Number(config.target_p50_latency_ms || 3000),
    },
  }
}

function fromRow(row) {
  const graded = Number(row?.graded_count || 0)
  const success = Number(row?.success_count || 0)
  return {
    gradedCount: graded,
    successCount: success,
    successRate: graded > 0 ? success / graded : null,
    p50LatencyMs: row?.p50_latency_ms == null ? null : Math.round(Number(row.p50_latency_ms)),
    lastObservedAt: row?.last_observed_at || null,
    confidence: Math.min(graded * 20, 100),
  }
}

export function estimateJson(estimate, capability, windowDays) {
  return {
    capability,
    modality: capability === "CONVERSATION_USAGE" ? "conversation" : "text",
    gradedCount: estimate.gradedCount,
    successCount: estimate.successCount,
    successRate: estimate.successRate,
    p50LatencyMs: estimate.p50LatencyMs,
    confidence: estimate.confidence,
    lastObservedAt: estimate.lastObservedAt,
    evidenceWindowDays: windowDays,
    estimatorVersion: ESTIMATOR,
  }
}

export async function loadEstimate(skillId, capability, windowDays, db = { query }) {
  const found = await db.query(
    `SELECT count(*)::bigint AS graded_count,
            count(*) FILTER (WHERE outcome = 'success')::bigint AS success_count,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)
              FILTER (WHERE latency_ms IS NOT NULL))::double precision AS p50_latency_ms,
            max(observed_at) AS last_observed_at
     FROM skill_trainer.effective_capability_evidence
     WHERE skill_id = $1 AND capability = $2
       AND modality = CASE WHEN $2 = 'CONVERSATION_USAGE' THEN 'conversation' ELSE 'text' END
       AND observed_at >= NOW() - make_interval(days => $3)`,
    [skillId, capability, windowDays],
  )
  return fromRow(found.rows[0])
}

export async function loadAggregateEstimate(domainId, capability, windowDays) {
  const found = await query(
    `SELECT count(*)::bigint AS graded_count,
            count(*) FILTER (WHERE outcome = 'success')::bigint AS success_count,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)
              FILTER (WHERE latency_ms IS NOT NULL))::double precision AS p50_latency_ms,
            max(observed_at) AS last_observed_at
     FROM skill_trainer.effective_capability_evidence ce
     JOIN skill_trainer.skill_concepts sc ON sc.id = ce.skill_id
     WHERE sc.phase = 1 AND sc.status = 'active' AND sc.domain_id = $1 AND ce.capability = $2
       AND ce.modality IN ('text', 'conversation')
       AND ce.observed_at >= NOW() - make_interval(days => $3)`,
    [domainId, capability, windowDays],
  )
  return fromRow(found.rows[0])
}

function deriveWeakness(capability, estimate, recognition, dominantCause, config) {
  if (estimate.gradedCount < config.min_graded_count) return null
  const rate = estimate.successRate ?? 0
  if (rate < config.target_success_rate) {
    const severity = Math.min(100, Math.max(1, Math.round((config.target_success_rate - rate) * 100)))
    const grounded = ["MEANING", "INTENT", "FORM_SELECTION"].includes(dominantCause) ? dominantCause : null
    let type = null
    if (capability === "CONTROLLED_RECALL") {
      type = grounded || (recognition
        && recognition.gradedCount >= config.min_graded_count
        && (recognition.successRate ?? 0) >= config.target_success_rate
        ? "CONTROLLED_RETRIEVAL"
        : null)
      if (!type) return null
    } else if (capability === "RECOGNITION") type = "MEANING"
    else if (capability === "SLOT_REPLACEMENT") type = grounded || "SLOT_REPLACEMENT"
    else if (capability === "CONTRAST_SELECTION") type = grounded || "CONTRAST_CONFUSION"
    else if (capability === "FREE_PRODUCTION") type = grounded || "FREE_RETRIEVAL"
    else if (capability === "CONVERSATION_USAGE") type = "CONVERSATION_USAGE"
    else if (capability.startsWith("RETENTION_")) type = "RETENTION"
    else return null
    return { type, severity }
  }
  const p50 = estimate.p50LatencyMs ?? 0
  if (p50 > config.target_p50_latency_ms) {
    const over = p50 - config.target_p50_latency_ms
    const severity = Math.min(100, Math.max(1, Math.round((over / config.target_p50_latency_ms) * 100)))
    return { type: "LATENCY", severity }
  }
  return null
}

function diagnosisJson(row) {
  return row
    ? {
      diagnosisId: row.diagnosis_id,
      type: row.diagnosis_type,
      status: row.status,
      severity: row.severity,
      confidence: row.confidence,
    }
    : null
}

export async function refreshDiagnosis(skillId, capability, estimate, policy) {
  const windowDays = policy.config.evidence_window_days
  const refs = await query(
    `SELECT evidence_id FROM skill_trainer.effective_capability_evidence
     WHERE skill_id = $1 AND capability = $2
       AND modality = CASE WHEN $2 = 'CONVERSATION_USAGE' THEN 'conversation' ELSE 'text' END
       AND observed_at >= NOW() - make_interval(days => $3)
     ORDER BY observed_at, evidence_id`,
    [skillId, capability, windowDays],
  )
  const cause = await query(
    `SELECT error_cause
     FROM skill_trainer.effective_capability_evidence
     WHERE skill_id = $1 AND capability = $2 AND outcome = 'failure'
       AND error_cause IN ('MEANING', 'INTENT', 'FORM_SELECTION')
       AND observed_at >= NOW() - make_interval(days => $3)
     GROUP BY error_cause
     ORDER BY count(*) DESC, error_cause
     LIMIT 1`,
    [skillId, capability, windowDays],
  )
  const dominantCause = cause.rows[0]?.error_cause || null
  const recognition = capability === "CONTROLLED_RECALL"
    ? await loadEstimate(skillId, "RECOGNITION", windowDays)
    : null
  const weakness = deriveWeakness(capability, estimate, recognition, dominantCause, policy.config)
  if (!weakness) {
    await query(
      `UPDATE skill_trainer.weakness_diagnoses
       SET status = 'resolved', resolved_at = NOW()
       WHERE learner_key = 'default' AND skill_id = $1
         AND target_capability = $2 AND status = 'active'`,
      [skillId, capability],
    )
    return null
  }
  await query(
    `UPDATE skill_trainer.weakness_diagnoses
     SET status = 'resolved', resolved_at = NOW()
     WHERE learner_key = 'default' AND skill_id = $1
       AND target_capability = $2 AND status = 'active' AND type <> $3`,
    [skillId, capability, weakness.type],
  )
  const snapshot = {
    estimate: estimateJson(estimate, capability, windowDays),
    dominantGroundedErrorCause: dominantCause,
    recognitionContrast: recognition ? estimateJson(recognition, "RECOGNITION", windowDays) : null,
    evidenceSelectionVersion: EVIDENCE_SELECTION,
  }
  const row = await query(
    `INSERT INTO skill_trainer.weakness_diagnoses
       (diagnosis_id, learner_key, skill_id, target_capability, type, status,
        severity, confidence, evidence_refs, evidence_snapshot, evidence_window,
        evidence_count, estimator_version, diagnosis_rule_version, policy_version)
     VALUES (gen_random_uuid(), 'default', $1, $2, $3, 'active', $4, $5, $6::uuid[], $7::jsonb,
             make_interval(days => $8), $9, $10, $11, $12)
     ON CONFLICT (learner_key, skill_id, target_capability, type) WHERE status = 'active'
     DO UPDATE SET severity = EXCLUDED.severity, confidence = EXCLUDED.confidence,
       evidence_refs = EXCLUDED.evidence_refs, evidence_snapshot = EXCLUDED.evidence_snapshot,
       evidence_count = EXCLUDED.evidence_count, last_confirmed_at = NOW(),
       estimator_version = EXCLUDED.estimator_version,
       diagnosis_rule_version = EXCLUDED.diagnosis_rule_version,
       policy_version = EXCLUDED.policy_version
     RETURNING diagnosis_id, type AS diagnosis_type, status, severity, confidence, resolved_at`,
    [
      skillId,
      capability,
      weakness.type,
      weakness.severity,
      estimate.confidence,
      refs.rows.map((item) => item.evidence_id),
      JSON.stringify(snapshot),
      windowDays,
      estimate.gradedCount,
      ESTIMATOR,
      DIAGNOSIS_RULE,
      policy.version,
    ],
  )
  return row.rows[0]
}

export async function estimateAndDiagnosis(skillId, capability, policyVersion, refresh) {
  const policy = await loadPolicy(policyVersion)
  const windowDays = policy.config.evidence_window_days
  const estimate = await loadEstimate(skillId, capability, windowDays)
  const diagnosis = refresh ? await refreshDiagnosis(skillId, capability, estimate, policy) : null
  return {
    estimate: estimateJson(estimate, capability, windowDays),
    diagnosis: diagnosisJson(diagnosis),
  }
}
