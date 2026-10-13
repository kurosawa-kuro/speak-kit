import { envelope, validationError } from "./envelope.mjs"
import { query } from "./db.mjs"
import {
  DERIVATION,
  DIAGNOSIS_RULE,
  ESTIMATOR,
  EVIDENCE_SELECTION,
  estimateJson,
  loadAggregateEstimate,
} from "./learning.mjs"

function requirementPasses(requirement, actual) {
  const threshold = Number(requirement.threshold)
  switch (requirement.comparator) {
    case ">=":
      return actual >= threshold
    case "<=":
      return actual <= threshold
    case ">":
      return actual > threshold
    case "<":
      return actual < threshold
    case "==":
      return Math.abs(actual - threshold) < Number.EPSILON
    default:
      throw new Error(`unsupported gate comparator: ${requirement.comparator}`)
  }
}

export async function evaluatePhaseGate(request, domainId) {
  const phase = Number.isInteger(request?.phase) ? request.phase : 1
  if (phase !== 1) return validationError("only Phase 1 gate is defined")
  const requested = typeof request?.policy_version === "string" && request.policy_version.trim()
    ? request.policy_version.trim()
    : null
  const policy = requested
    ? await query(
      `SELECT version, requirements, required_scenarios
       FROM skill_trainer.learner_phase_gate_policies
       WHERE phase = $1 AND version = $2`,
      [phase, requested],
    )
    : await query(
      `SELECT version, requirements, required_scenarios
       FROM skill_trainer.learner_phase_gate_policies
       WHERE phase = $1 ORDER BY effective_at DESC LIMIT 1`,
      [phase],
    )
  const row = policy.rows[0]
  if (!row) return envelope(false, "not_found", {}, { message: "gate policy not found" })
  const requirements = row.requirements
  if (!Array.isArray(requirements) || !requirements.length) throw new Error("gate policy has no requirements")
  const results = []
  let insufficient = false
  let failed = false
  for (const raw of requirements) {
    const requirement = { min_distinct_skills: 1, ...raw }
    if (!(requirement.window_days > 0)) throw new Error("gate window must be positive")
    if (!(requirement.min_graded_count > 0)) throw new Error("gate minimum graded count must be positive")
    if (!(requirement.min_distinct_skills > 0)) throw new Error("gate minimum distinct skills must be positive")
    const estimate = await loadAggregateEstimate(domainId, requirement.capability, requirement.window_days)
    const distinct = await query(
      `SELECT count(DISTINCT ce.skill_id)::int AS count
       FROM skill_trainer.effective_capability_evidence ce
       JOIN skill_trainer.skill_concepts sc ON sc.id = ce.skill_id
       WHERE ce.capability = $1
         AND sc.domain_id = $2
         AND ce.observed_at >= NOW() - make_interval(days => $3)`,
      [requirement.capability, domainId, requirement.window_days],
    )
    const distinctSkills = distinct.rows[0].count
    let actual
    if (requirement.metric === "success_rate") actual = estimate.successRate
    else if (requirement.metric === "p50_latency_ms") actual = estimate.p50LatencyMs
    else throw new Error(`unsupported gate metric: ${requirement.metric}`)
    let status
    if (estimate.gradedCount < requirement.min_graded_count || distinctSkills < requirement.min_distinct_skills) {
      insufficient = true
      status = "insufficient_evidence"
    } else if (actual == null) {
      insufficient = true
      status = "insufficient_evidence"
    } else if (requirementPasses(requirement, actual)) {
      status = "passed"
    } else {
      failed = true
      status = "not_passed"
    }
    results.push({
      scope: "phase1",
      capability: requirement.capability,
      metric: requirement.metric,
      actual,
      threshold: requirement.threshold,
      comparator: requirement.comparator,
      minGradedCount: requirement.min_graded_count,
      distinctSkillCount: distinctSkills,
      minDistinctSkills: requirement.min_distinct_skills,
      windowDays: requirement.window_days,
      status,
      estimate: estimateJson(estimate, requirement.capability, requirement.window_days),
    })
  }
  const scenarios = row.required_scenarios
  if (!Array.isArray(scenarios)) throw new Error("parse learner phase gate scenarios")
  const scenarioResults = []
  for (const scenario of scenarios) {
    if (!(scenario.min_duration_seconds > 0 && scenario.min_self_questions >= 0)) {
      throw new Error("scenario gate thresholds must be non-negative")
    }
    const observed = await query(
      `SELECT count(*)::int AS sessions,
              max(extract(epoch FROM (ended_at - started_at))::bigint)::int AS max_duration,
              max(self_question_count)::int AS max_self_questions,
              count(*) FILTER (
                WHERE extract(epoch FROM (ended_at - started_at))::bigint >= $2
                  AND self_question_count >= $3
              )::int AS qualifying
       FROM skill_trainer.conversation_sessions
       WHERE scenario = $1 AND ended_at IS NOT NULL AND domain_id = $4`,
      [scenario.scenario, scenario.min_duration_seconds, scenario.min_self_questions, domainId],
    )
    const stats = observed.rows[0]
    let status
    if (stats.sessions === 0) {
      insufficient = true
      status = "insufficient_evidence"
    } else if (stats.qualifying > 0) {
      status = "passed"
    } else {
      failed = true
      status = "not_passed"
    }
    scenarioResults.push({
      scenario: scenario.scenario,
      sessionCount: stats.sessions,
      maxDurationSeconds: stats.max_duration,
      maxSelfQuestions: stats.max_self_questions,
      qualifyingSessionCount: stats.qualifying,
      requiredDurationSeconds: scenario.min_duration_seconds,
      requiredSelfQuestions: scenario.min_self_questions,
      status,
    })
  }
  return envelope(true, "ok", {
    phase: 1,
    status: failed ? "not_passed" : insufficient ? "insufficient_evidence" : "passed",
    policyVersion: row.version,
    requirements,
    requiredScenarios: scenarios,
    results,
    scenarioResults,
  }, null)
}

export async function getTrace(request) {
  const planItemId = request.plan_item_id.trim().toLowerCase()
  const found = await query(
    `SELECT pi.plan_id, pi.plan_item_id, re.exercise_instance_id,
            a.attempt_id, go.grading_id, ce.evidence_id, p.policy_version
     FROM skill_trainer.training_plan_items pi
     JOIN skill_trainer.training_plans p ON p.plan_id = pi.plan_id
     JOIN skill_trainer.rendered_exercises re ON re.plan_item_id = pi.plan_item_id
     LEFT JOIN skill_trainer.training_attempts a ON a.plan_item_id = pi.plan_item_id
     LEFT JOIN skill_trainer.effective_capability_evidence ce ON ce.training_attempt_id = a.attempt_id
     LEFT JOIN skill_trainer.grading_observations go ON go.grading_id = ce.grading_id
     WHERE pi.plan_item_id = $1 ORDER BY a.created_at DESC, go.created_at DESC LIMIT 1`,
    [planItemId],
  )
  const row = found.rows[0]
  if (!row) return envelope(false, "not_found", {}, { message: "plan item not found" })
  const diagnoses = await query(
    `SELECT diagnosis_id FROM skill_trainer.weakness_diagnoses
     WHERE evidence_refs && ARRAY[$1]::uuid[] ORDER BY diagnosed_at`,
    [row.evidence_id],
  ).catch(() => ({ rows: [] }))
  const next = await query(
    `SELECT pi2.plan_item_id
     FROM skill_trainer.training_plan_items pi1
     JOIN skill_trainer.training_plans p1 ON p1.plan_id = pi1.plan_id
     JOIN skill_trainer.training_plans p2 ON p2.learner_key = p1.learner_key AND p2.created_at > p1.created_at
     JOIN skill_trainer.training_plan_items pi2 ON pi2.plan_id = p2.plan_id
     WHERE pi1.plan_item_id = $1 ORDER BY p2.created_at, pi2.ordinal LIMIT 1`,
    [planItemId],
  )
  return envelope(true, "ok", {
    planId: row.plan_id,
    planItemId: row.plan_item_id,
    exerciseInstanceId: row.exercise_instance_id,
    attemptId: row.attempt_id,
    gradingId: row.grading_id,
    evidenceId: row.evidence_id,
    diagnosisIds: diagnoses.rows.map((item) => item.diagnosis_id),
    nextPlanItemId: next.rows[0]?.plan_item_id ?? null,
    versions: {
      policy: row.policy_version,
      estimator: ESTIMATOR,
      diagnosisRule: DIAGNOSIS_RULE,
      evidenceDerivation: DERIVATION,
      evidenceSelection: EVIDENCE_SELECTION,
    },
  }, null)
}
