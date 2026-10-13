import { aiEnabled } from "./ai/isEnabled.mjs"
import { envelope, validationError } from "./envelope.mjs"
import { query } from "./db.mjs"

function meets(metric, actual, comparator, threshold) {
  if (actual == null) return false
  if (comparator === ">=") return actual >= threshold
  if (comparator === "<=") return actual <= threshold
  return false
}

export async function evaluatePhaseGate(request, domainId) {
  const phase = request?.phase ?? 1
  if (phase !== 1) return validationError("only Phase 1 gate is defined")
  const policy = await query(
    `SELECT version, requirements, required_scenarios
     FROM skill_trainer.learner_phase_gate_policies
     WHERE phase = 1
     ORDER BY effective_at DESC
     LIMIT 1`,
  )
  const row = policy.rows[0]
  if (!row) return envelope(false, "not_found", {}, { message: "gate policy not found" })
  const requirements = Array.isArray(row.requirements) ? row.requirements : []
  const results = []
  let passed = requirements.length > 0
  for (const requirement of requirements) {
    const measured = await query(
      `SELECT count(*)::int AS graded,
              count(*) FILTER (WHERE ce.outcome = 'success')::int AS success,
              count(DISTINCT ce.skill_id)::int AS skills,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY ce.latency_ms)
                FILTER (WHERE ce.latency_ms IS NOT NULL))::float AS p50
       FROM skill_trainer.effective_capability_evidence ce
       JOIN skill_trainer.skill_concepts sc ON sc.id = ce.skill_id
       WHERE ce.capability = $1 AND sc.domain_id = $2
         AND ce.observed_at >= NOW() - make_interval(days => $3)`,
      [requirement.capability, domainId, requirement.window_days],
    )
    const stats = measured.rows[0]
    const enough = stats.graded >= requirement.min_graded_count && stats.skills >= requirement.min_distinct_skills
    const actual = requirement.metric === "success_rate"
      ? (stats.graded ? stats.success / stats.graded : null)
      : stats.p50
    const ok = enough && meets(requirement.metric, actual, requirement.comparator, requirement.threshold)
    if (!ok) passed = false
    results.push({
      capability: requirement.capability,
      metric: requirement.metric,
      actual,
      threshold: requirement.threshold,
      graded: stats.graded,
      distinctSkills: stats.skills,
      passed: ok,
    })
  }
  const scenarios = Array.isArray(row.required_scenarios) ? row.required_scenarios : []
  for (const scenario of scenarios) {
    const found = await query(
      `SELECT count(*)::int AS sessions
       FROM skill_trainer.conversation_sessions
       WHERE domain_id = $1 AND scenario = $2 AND ended_at IS NOT NULL
         AND self_question_count >= $3
         AND extract(epoch FROM (ended_at - started_at)) >= $4`,
      [domainId, scenario.scenario, scenario.min_self_questions, scenario.min_duration_seconds],
    )
    const ok = found.rows[0].sessions > 0
    if (!ok) passed = false
    results.push({ scenario: scenario.scenario, passed: ok, sessions: found.rows[0].sessions })
  }
  return envelope(true, "ok", {
    phase: 1,
    policyVersion: row.version,
    passed,
    results,
    aiAvailable: aiEnabled(),
  }, null)
}
