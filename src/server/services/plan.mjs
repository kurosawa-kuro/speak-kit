import { aiAvailability } from "./ai/isEnabled.mjs"
import { envelope, validationError } from "./envelope.mjs"
import { query, withTransaction } from "./db.mjs"
import { quizProgress, quizRoute } from "./quiz.mjs"
import { createAdaptivePlan } from "./planner.mjs"
import { listPairs, nextDueNotice, watchCount } from "./boundary.mjs"
import { ESTIMATOR, loadEstimate, loadPolicy } from "./learning.mjs"

const ENGLISH = "english_conversation"
const FALLBACK_POLICY_VERSION = "phase1-adaptive-v2"

function text(request, key) {
  const value = request?.[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function domainCode(request) {
  return text(request, "domain_code") || ENGLISH
}

async function domainId(code) {
  const result = await query("SELECT id FROM skill_trainer.domains WHERE code = $1", [code])
  return result.rows[0]?.id ?? null
}

function promptAlreadyMastered(promptExpr, domainId) {
  const reset = `COALESCE((SELECT max(requested_at) FROM skill_trainer.review_resets
    WHERE learner_key = 'default' AND domain_id = ${Number(domainId)}), '-infinity'::timestamptz)`
  return `EXISTS (
    SELECT 1 FROM skill_trainer.capability_evidence mastered
    JOIN skill_trainer.training_attempts mastered_attempt ON mastered_attempt.attempt_id = mastered.training_attempt_id
    JOIN skill_trainer.rendered_exercises mastered_render ON mastered_render.exercise_instance_id = mastered_attempt.exercise_instance_id
    WHERE mastered_render.prompt = ${promptExpr}
      AND mastered.outcome = 'success' AND mastered.observed_at > ${reset}
      AND NOT EXISTS (
        SELECT 1 FROM skill_trainer.capability_evidence relapsed
        JOIN skill_trainer.training_attempts relapsed_attempt ON relapsed_attempt.attempt_id = relapsed.training_attempt_id
        JOIN skill_trainer.rendered_exercises relapsed_render ON relapsed_render.exercise_instance_id = relapsed_attempt.exercise_instance_id
        WHERE relapsed_render.prompt = mastered_render.prompt
          AND relapsed.outcome = 'failure' AND relapsed.observed_at > mastered.observed_at
      )
  )`
}

async function planView(planId, domainId, code) {
  const english = code === ENGLISH
  await query(
    `UPDATE skill_trainer.training_plan_items pi
     SET status = 'skipped', completed_at = NOW()
     FROM skill_trainer.rendered_exercises re
     WHERE re.plan_item_id = pi.plan_item_id
       AND pi.plan_id = $1
       AND pi.status = 'planned'
       AND pi.purpose <> 'Verify'
       AND ${promptAlreadyMastered("re.prompt", domainId)}`,
    [planId],
  )
  const rows = await query(
    `SELECT p.policy_version, pi.plan_item_id, pi.purpose,
            sc.stable_key, sc.canonical_form, sc.meaning, sc.category,
            pi.target_capability, pi.diagnosis_id, pi.diagnosis_type,
            pi.reason_code, pi.selection_snapshot, pi.dose, pi.stop_condition,
            pi.exercise_key, pi.exercise_version, pi.training_mode, pi.status AS item_status,
            re.exercise_instance_id, re.prompt, re.expected_reference, re.modality
     FROM skill_trainer.training_plans p
     JOIN skill_trainer.training_plan_items pi ON pi.plan_id = p.plan_id
     JOIN skill_trainer.skill_concepts sc ON sc.id = pi.skill_id
     JOIN skill_trainer.rendered_exercises re ON re.plan_item_id = pi.plan_item_id
     WHERE p.plan_id = $1
       AND pi.status IN ('planned', 'in_progress', 'awaiting_grade')
     ORDER BY pi.ordinal`,
    [planId],
  )
  const first = rows.rows[0]
  const primaryFocus = first
    ? {
      kind: first.purpose === "Measure" ? "EvidenceGap" : "Diagnosis",
      skillKey: first.stable_key,
      skillLabel: first.meaning,
      canonicalForm: first.canonical_form,
      category: first.category,
      capability: first.target_capability,
      diagnosisId: first.diagnosis_id,
      weaknessType: first.diagnosis_type,
      purpose: first.purpose,
      metrics: first.selection_snapshot,
    }
    : null
  const dueConfusion = english ? await nextDueNotice() : null
  const items = rows.rows.map((row) => ({
    planItemId: row.plan_item_id,
    purpose: row.purpose,
    skillKey: row.stable_key,
    skillLabel: row.meaning,
    canonicalForm: row.canonical_form,
    category: row.category,
    capability: row.target_capability,
    diagnosisId: row.diagnosis_id,
    weaknessType: row.diagnosis_type,
    reasonCode: row.reason_code,
    selectionSnapshot: row.selection_snapshot,
    dose: row.dose,
    stopCondition: row.stop_condition,
    trainingMode: row.training_mode,
    status: row.item_status,
    exercise: {
      exerciseKey: row.exercise_key,
      exerciseVersion: row.exercise_version,
      exerciseInstanceId: row.exercise_instance_id,
      prompt: row.prompt,
      expectedReference: row.expected_reference,
      modality: row.modality,
    },
  }))
  return envelope(
    true,
    "ok",
    {
      planId,
      policyVersion: first?.policy_version || FALLBACK_POLICY_VERSION,
      primaryFocus,
      plan: items,
      dueConfusion,
      route: english ? await quizRoute() : null,
      ...(await aiAvailability()),
    },
    null,
  )
}

export async function getTodayPlan(request) {
  const code = domainCode(request)
  const id = await domainId(code)
  if (!id) return validationError("unknown domain_code")
  const policy = await loadPolicy()
  const planned = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('skill_trainer:adaptive:' || $1))", [code])
    await client.query(
      `UPDATE skill_trainer.training_plans
       SET status = 'superseded'
       WHERE learner_key = 'default' AND status = 'active' AND domain_id = $1
         AND input_snapshot->>'selectionRule' = 'measure_catalog_v1'`,
      [id],
    )
    const existing = await client.query(
      `SELECT plan_id FROM skill_trainer.training_plans
       WHERE learner_key = 'default' AND status = 'active' AND domain_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [id],
    )
    if (existing.rows[0]) return { planId: existing.rows[0].plan_id }
    await client.query(
      `WITH due AS (
         SELECT DISTINCT ON (ed.target_skill_id, ed.target_capability)
                ed.target_skill_id AS skill_id, ed.target_capability,
                ce.evidence_id, ce.observed_at,
                (ed.rubric->>'retention_days')::int AS retention_days
         FROM skill_trainer.exercise_definitions ed
         JOIN skill_trainer.skill_concepts retention_domain
           ON retention_domain.id = ed.target_skill_id
          AND retention_domain.domain_id = $3
         JOIN LATERAL (
           SELECT evidence_id, observed_at
           FROM skill_trainer.effective_capability_evidence base
           WHERE base.skill_id = ed.target_skill_id
             AND base.capability = 'CONTROLLED_RECALL' AND base.outcome = 'success'
           ORDER BY observed_at DESC LIMIT 1
         ) ce ON TRUE
         WHERE ed.status = 'active' AND ed.training_mode = 'spaced_retrieval'
           AND ce.observed_at <= NOW() - make_interval(days => (ed.rubric->>'retention_days')::int)
           AND NOT EXISTS (
             SELECT 1 FROM skill_trainer.effective_capability_evidence probe
             WHERE probe.skill_id = ed.target_skill_id
               AND probe.capability = ed.target_capability
               AND probe.observed_at >= ce.observed_at
           )
         ORDER BY ed.target_skill_id, ed.target_capability, ed.version DESC
       )
       INSERT INTO skill_trainer.weakness_diagnoses
         (diagnosis_id, learner_key, skill_id, target_capability, type, status,
          severity, confidence, evidence_refs, evidence_snapshot, evidence_window,
          evidence_count, estimator_version, diagnosis_rule_version, policy_version)
       SELECT gen_random_uuid(), 'default', skill_id, target_capability, 'RETENTION', 'active',
              LEAST(100, 40 + retention_days)::smallint, 100,
              ARRAY[evidence_id],
              jsonb_build_object('reason','retention_due','sourceEvidenceId',evidence_id,
                                 'sourceObservedAt',observed_at,'retentionDays',retention_days),
              make_interval(days => retention_days), 1, $1, 'retention-schedule-v1', $2
       FROM due
       ON CONFLICT (learner_key, skill_id, target_capability, type) WHERE status = 'active'
       DO UPDATE SET last_confirmed_at = NOW(), evidence_refs = EXCLUDED.evidence_refs,
                     evidence_snapshot = EXCLUDED.evidence_snapshot,
                     policy_version = EXCLUDED.policy_version`,
      [ESTIMATOR, policy.version, id],
    )
    return { planId: await createAdaptivePlan(client, id, policy.version, policy.config) }
  })
  if (!planned.planId) {
    return envelope(true, "ok", { planId: null, primaryFocus: null, plan: [] }, null)
  }
  return planView(planned.planId, id, code)
}

export async function getProgress(request) {
  const code = domainCode(request)
  const id = await domainId(code)
  if (!id) return validationError("unknown domain_code")
  const policy = await loadPolicy()
  const windowDays = policy.config.evidence_window_days
  const skillRows = await query(
    `SELECT id AS skill_id, stable_key, canonical_form, meaning, category, tier
     FROM skill_trainer.skill_concepts
     WHERE status = 'active' AND domain_id = $1
     ORDER BY category, stable_key`,
    [id],
  )
  const skills = []
  for (const row of skillRows.rows) {
    const capabilities = await query(
      `SELECT DISTINCT target_capability AS capability
       FROM skill_trainer.exercise_definitions
       WHERE target_skill_id = $1 AND status = 'active'
       UNION
       SELECT DISTINCT capability
       FROM skill_trainer.effective_capability_evidence
       WHERE skill_id = $1
       ORDER BY 1`,
      [row.skill_id],
    )
    const views = []
    for (const { capability } of capabilities.rows) {
      const estimate = await loadEstimate(row.skill_id, capability, windowDays)
      views.push({
        capability,
        status: estimate.gradedCount === 0 ? "unmeasured" : "measured",
        metric: "success_rate",
        unit: "ratio",
        successCount: estimate.successCount,
        gradedCount: estimate.gradedCount,
        successRate: estimate.successRate,
        p50LatencyMs: estimate.p50LatencyMs,
        confidence: estimate.confidence,
        lastObservedAt: estimate.lastObservedAt,
        evidenceWindowDays: windowDays,
        estimatorVersion: ESTIMATOR,
      })
    }
    const diagnoses = await query(
      `SELECT diagnosis_id, type AS diagnosis_type, status, severity, confidence, resolved_at
       FROM skill_trainer.weakness_diagnoses
       WHERE skill_id = $1 ORDER BY diagnosed_at DESC LIMIT 5`,
      [row.skill_id],
    )
    skills.push({
      skillId: Number(row.skill_id),
      skillKey: row.stable_key,
      canonicalForm: row.canonical_form,
      meaning: row.meaning,
      category: row.category,
      tier: row.tier,
      capabilities: views,
      diagnoses: diagnoses.rows.map((item) => ({
        diagnosisId: item.diagnosis_id,
        type: item.diagnosis_type,
        status: item.status,
        severity: item.severity,
        confidence: item.confidence,
        resolvedAt: item.resolved_at,
      })),
    })
  }
  const talk = await query(
    `SELECT count(*)::int AS sessions,
            coalesce(sum(self_question_count), 0)::int AS self_question,
            coalesce(sum(follow_up_count), 0)::int AS follow_up,
            coalesce(sum(error_handling_count), 0)::int AS error_handling,
            coalesce(sum(freeze_count), 0)::int AS freeze,
            coalesce(sum(japanese_fallback_count), 0)::int AS japanese,
            round(avg(avg_latency_ms))::int AS latency
     FROM skill_trainer.conversation_sessions
     WHERE ended_at IS NOT NULL AND domain_id = $1`,
    [id],
  )
  const graders = await query(
    `SELECT go.observer_version, go.status, count(*)::int AS count
     FROM skill_trainer.grading_observations go
     LEFT JOIN skill_trainer.training_attempts ta ON ta.attempt_id = go.training_attempt_id
     LEFT JOIN skill_trainer.conversation_turns ct ON ct.id = go.conversation_turn_id
     LEFT JOIN skill_trainer.conversation_sessions cs ON cs.id = ct.conversation_session_id
     WHERE (ta.attempt_id IS NOT NULL AND ${inDomain("ta", id)}) OR cs.domain_id = $1
     GROUP BY go.observer_version, go.status
     ORDER BY go.observer_version, go.status`,
    [id],
  )
  const week = await weeklySummary(id)
  const english = code === ENGLISH
  const review = await reviewCounts(id)
  const t = talk.rows[0]
  return envelope(
    true,
    "ok",
    {
      skills,
      weeklySummary: week,
      confusionPairs: english ? await listPairs() : [],
      confusionWatchCount: english ? await watchCount() : 0,
      masteredPromptCount: review.mastered,
      recheckDueCount: review.recheck,
      quickQuiz: english ? await quizProgress() : null,
      talkSummary: {
        totalSessions: t.sessions,
        totalSelfQuestionCount: t.self_question,
        totalFollowUpCount: t.follow_up,
        totalErrorHandlingCount: t.error_handling,
        totalFreezeCount: t.freeze,
        totalJapaneseFallbackCount: t.japanese,
        avgLatencyMs: t.latency,
        note: "Session metrics do not directly change capability estimates.",
      },
      graderStats: graders.rows.map((row) => ({ observerVersion: row.observer_version, status: row.status, count: row.count })),
      policyVersion: policy.version,
      estimatorVersion: ESTIMATOR,
    },
    null,
  )
}

function tokyoWeekStart(now = new Date()) {
  const shifted = new Date(now.getTime() + 9 * 3600 * 1000)
  const mondayOffset = (shifted.getUTCDay() + 6) % 7
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - mondayOffset * 86400000 - 9 * 3600 * 1000)
}

function inDomain(alias, domainId) {
  return `EXISTS (
    SELECT 1 FROM skill_trainer.exercises domain_ex
    JOIN skill_trainer.assessment_contracts domain_ac
      ON domain_ac.contract_key = domain_ex.assessment_contract_key
     AND domain_ac.version = domain_ex.assessment_contract_version
    WHERE domain_ex.exercise_id = ${alias}.exercise_id AND domain_ac.domain_id = ${Number(domainId)}
  )`
}

function phrase(canonical) {
  return String(canonical || "").replace(/\{[^}]*\}/g, "...")
}

async function skillWindow(domainId, start, end) {
  const rows = await query(
    `SELECT sc.id, sc.canonical_form, sc.meaning,
            count(*) FILTER (WHERE e.outcome = 'success')::int AS success,
            count(*)::int AS graded,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY e.latency_ms)
              FILTER (WHERE e.latency_ms IS NOT NULL))::double precision AS p50
     FROM skill_trainer.effective_capability_evidence e
     JOIN skill_trainer.skill_concepts sc ON sc.id = e.skill_id
     WHERE e.observed_at >= $1 AND e.observed_at < $2 AND sc.domain_id = $3
     GROUP BY sc.id, sc.canonical_form, sc.meaning`,
    [start, end, domainId],
  )
  return rows.rows
}

function stableSkill(row) {
  return row.graded >= 3 && row.success / row.graded >= 0.8
}

function bottleneck(row) {
  if (row.graded <= 0) return false
  return row.success / row.graded < 0.5 || (row.p50 ?? 0) >= 20000
}

function weeklyFocus(active, measured) {
  const chosen = []
  const focus = []
  const push = (skillId, canonical, meaning) => {
    if (chosen.includes(String(skillId)) || focus.length === 3) return
    chosen.push(String(skillId))
    focus.push({ phrase: phrase(canonical), meaning })
  }
  const slow = measured.filter(bottleneck).sort((left, right) => {
    const rate = left.success / Math.max(left.graded, 1) - right.success / Math.max(right.graded, 1)
    return rate !== 0 ? rate : (right.p50 ?? 0) - (left.p50 ?? 0)
  })
  for (const row of slow) push(row.id, row.canonical_form, row.meaning)
  const sorted = [...active].sort((left, right) => right.severity - left.severity || Number(left.id) - Number(right.id))
  for (const row of sorted) push(row.id, row.canonical_form, row.meaning)
  return focus
}

async function weeklySummary(domainId) {
  const start = tokyoWeekStart()
  const end = new Date(start.getTime() + 7 * 86400000)
  const previous = new Date(start.getTime() - 7 * 86400000)
  const domain = inDomain("ta", domainId)
  const counts = await query(
    `SELECT
       (SELECT count(*)::int FROM (
          SELECT (ta.occurred_at AT TIME ZONE 'Asia/Tokyo')::date AS practice_day
          FROM skill_trainer.training_attempts ta
          WHERE ta.occurred_at >= $1 AND ta.occurred_at < $2 AND ${domain}
          UNION
          SELECT (started_at AT TIME ZONE 'Asia/Tokyo')::date
          FROM skill_trainer.conversation_sessions
          WHERE started_at >= $1 AND started_at < $2 AND domain_id = $3
       ) practice_days) AS practice_days,
       (SELECT count(*)::int FROM skill_trainer.training_attempts ta
        WHERE ta.occurred_at >= $1 AND ta.occurred_at < $2 AND ${domain}) AS answers,
       (SELECT count(*)::int FROM skill_trainer.conversation_sessions
        WHERE started_at >= $1 AND started_at < $2 AND domain_id = $3) AS talks,
       (SELECT coalesce(round(sum(extract(epoch FROM (ended_at - started_at)))::numeric / 60), 0)::int
        FROM skill_trainer.conversation_sessions
        WHERE started_at >= $1 AND started_at < $2 AND ended_at IS NOT NULL AND domain_id = $3) AS minutes`,
    [start, end, domainId],
  )
  const latency = await query(
    `SELECT count(ta.latency_ms)::int AS samples,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY ta.latency_ms))::float AS p50
     FROM skill_trainer.training_attempts ta
     WHERE ta.occurred_at >= $1 AND ta.occurred_at < $2 AND ${domain}`,
    [start, end],
  )
  const before = await query(
    `SELECT count(ta.latency_ms)::int AS samples,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY ta.latency_ms))::float AS p50
     FROM skill_trainer.training_attempts ta
     WHERE ta.occurred_at >= $1 AND ta.occurred_at < $2 AND ${domain}`,
    [previous, start],
  )
  const current = await skillWindow(domainId, start, end)
  const prior = await skillWindow(domainId, previous, start)
  const newly = current
    .filter((row) => stableSkill(row) && !prior.some((item) => item.id === row.id && stableSkill(item)))
    .sort((left, right) => (left.canonical_form < right.canonical_form ? -1 : left.canonical_form > right.canonical_form ? 1 : 0))
  const active = await query(
    `SELECT sc.id, sc.canonical_form, sc.meaning, wd.severity::int AS severity
     FROM skill_trainer.weakness_diagnoses wd
     JOIN skill_trainer.skill_concepts sc ON sc.id = wd.skill_id
     WHERE wd.status = 'active' AND sc.domain_id = $1`,
    [domainId],
  )
  const overcome = await query(
    `SELECT sc.canonical_form, sc.meaning
     FROM skill_trainer.weakness_diagnoses wd
     JOIN skill_trainer.skill_concepts sc ON sc.id = wd.skill_id
     WHERE wd.status = 'resolved' AND wd.resolved_at >= $1 AND wd.resolved_at < $2 AND sc.domain_id = $3
     ORDER BY wd.resolved_at DESC`,
    [start, end, domainId],
  )
  const focus = weeklyFocus(active.rows, current)
  const nowLatency = latency.rows[0]
  const beforeLatency = before.rows[0]
  return {
    practiceDays: counts.rows[0].practice_days,
    answerCount: counts.rows[0].answers,
    talkSessions: counts.rows[0].talks,
    talkMinutes: counts.rows[0].minutes,
    latencyNowMs: nowLatency.samples >= 1 && nowLatency.p50 != null ? Math.round(nowLatency.p50) : null,
    latencyBeforeMs: beforeLatency.samples >= 3 && beforeLatency.p50 != null ? Math.round(beforeLatency.p50) : null,
    newlyStableCount: newly.length,
    newlyStable: newly.slice(0, 3).map((row) => ({ phrase: phrase(row.canonical_form), meaning: row.meaning })),
    overcomeCount: overcome.rows.length,
    overcome: overcome.rows.slice(0, 3).map((row) => ({ phrase: phrase(row.canonical_form), meaning: row.meaning })),
    focus,
  }
}

export async function reviewCounts(domainId) {
  const reset = `COALESCE((SELECT max(requested_at) FROM skill_trainer.review_resets WHERE learner_key = 'default' AND domain_id = ${Number(domainId)}), '-infinity'::timestamptz)`
  const counted = await query(
    `WITH counted AS (
       SELECT DISTINCT re.prompt
       FROM skill_trainer.capability_evidence ce
       JOIN skill_trainer.training_attempts ta ON ta.attempt_id = ce.training_attempt_id
       JOIN skill_trainer.rendered_exercises re ON re.exercise_instance_id = ta.exercise_instance_id
       WHERE ${inDomain("ta", domainId)}
     )
     SELECT
       (SELECT count(*) FROM counted WHERE ${promptAlreadyMastered("counted.prompt", domainId)})::int AS mastered,
       (SELECT count(DISTINCT prior_render.prompt)
        FROM skill_trainer.capability_evidence prior_success
        JOIN skill_trainer.training_attempts prior_attempt ON prior_attempt.attempt_id = prior_success.training_attempt_id
        JOIN skill_trainer.rendered_exercises prior_render ON prior_render.exercise_instance_id = prior_attempt.exercise_instance_id
        WHERE prior_success.outcome = 'success'
          AND prior_success.observed_at <= ${reset}
          AND ${inDomain("prior_attempt", domainId)}
          AND NOT EXISTS (
            SELECT 1
            FROM skill_trainer.capability_evidence after_reset
            JOIN skill_trainer.training_attempts after_attempt ON after_attempt.attempt_id = after_reset.training_attempt_id
            JOIN skill_trainer.rendered_exercises after_render ON after_render.exercise_instance_id = after_attempt.exercise_instance_id
            WHERE after_render.prompt = prior_render.prompt
              AND after_reset.observed_at > ${reset}
          ))::int AS recheck`,
  )
  return { mastered: counted.rows[0].mastered, recheck: counted.rows[0].recheck }
}
