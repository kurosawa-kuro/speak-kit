import { aiEnabled } from "./ai/isEnabled.mjs"
import { envelope, validationError } from "./envelope.mjs"
import { query, withTransaction } from "./db.mjs"
import { quizBoard, quizRoute } from "./quiz.mjs"
import { createAdaptivePlan } from "./planner.mjs"

const ENGLISH = "english_conversation"

function text(request, key) {
  const value = request?.[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function domainCode(request) {
  return text(request, "domain_code") || ENGLISH
}

function aiAvailable() {
  return aiEnabled()
}

async function domainId(code) {
  const result = await query("SELECT id FROM skill_trainer.domains WHERE code = $1", [code])
  return result.rows[0]?.id ?? null
}

async function planView(db, planId, policyVersion) {
  const rows = await db.query(
    `SELECT p.policy_version, pi.plan_item_id, pi.purpose,
            sc.stable_key, sc.canonical_form, sc.meaning, sc.category,
            pi.target_capability, pi.diagnosis_id, pi.diagnosis_type,
            pi.reason_code, pi.selection_snapshot, pi.dose, pi.stop_condition,
            pi.exercise_key, pi.exercise_version, pi.training_mode, pi.status AS item_status,
            re.exercise_instance_id, re.prompt, re.expected_reference, re.modality
     FROM skill_trainer.training_plans p
     JOIN skill_trainer.training_plan_items pi ON pi.plan_id = p.plan_id
     JOIN skill_trainer.skill_concepts sc ON sc.id = pi.skill_id
     LEFT JOIN skill_trainer.rendered_exercises re ON re.plan_item_id = pi.plan_item_id
     WHERE p.plan_id = $1
       AND pi.status IN ('planned', 'in_progress', 'awaiting_grade')
     ORDER BY pi.ordinal`,
    [planId],
  )
  const items = rows.rows
    .filter((row) => row.exercise_instance_id)
    .map((row) => ({
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
  const first = items[0]
  return envelope(
    true,
    "ok",
    {
      planId,
      policyVersion: rows.rows[0]?.policy_version || policyVersion,
      primaryFocus: first
        ? {
            kind: first.purpose === "Measure" ? "EvidenceGap" : "Diagnosis",
            skillKey: first.skillKey,
            skillLabel: first.skillLabel,
            canonicalForm: first.canonicalForm,
            category: first.category,
            capability: first.capability,
            diagnosisId: first.diagnosisId,
            weaknessType: first.weaknessType,
            purpose: first.purpose,
            metrics: {
              estimate: {
                successRate: first.selectionSnapshot?.estimate?.successRate ?? null,
                p50LatencyMs: first.selectionSnapshot?.estimate?.p50LatencyMs ?? null,
                gradedCount: first.selectionSnapshot?.estimate?.gradedCount ?? 0,
                confidence: first.selectionSnapshot?.estimate?.confidence ?? 0,
              },
              target: {
                successRate: first.selectionSnapshot?.target?.successRate ?? 0.8,
                p50LatencyMs: first.selectionSnapshot?.target?.p50LatencyMs ?? 3000,
              },
            },
          }
        : null,
      plan: items,
      dueConfusion: await dueConfusion(db),
      route: await quizRoute(),
      aiAvailable: aiAvailable(),
    },
    null,
  )
}

export async function getTodayPlan(request) {
  const code = domainCode(request)
  const id = await domainId(code)
  if (!id) return validationError("unknown domain_code")
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('skill_trainer:adaptive:' || $1))", [code])
    await client.query(
      `UPDATE skill_trainer.training_plans
       SET status = 'superseded'
       WHERE learner_key = 'default' AND status = 'active' AND domain_id = $1
         AND input_snapshot->>'selectionRule' = 'measure_catalog_v1'`,
      [id],
    )
    const existing = await client.query(
      `SELECT plan_id, policy_version FROM skill_trainer.training_plans
       WHERE learner_key = 'default' AND status = 'active' AND domain_id = $1`,
      [id],
    )
    if (existing.rows[0]) {
      return planView(client, existing.rows[0].plan_id, existing.rows[0].policy_version)
    }
    const policy = await client.query(
      `SELECT policy_version, config FROM skill_trainer.learning_policy_versions
       ORDER BY created_at DESC NULLS LAST LIMIT 1`,
    )
    const policyVersion = policy.rows[0]?.policy_version
    if (!policyVersion) {
      return envelope(true, "ok", { planId: null, primaryFocus: null, plan: [], aiAvailable: aiAvailable() }, null)
    }
    const planId = await createAdaptivePlan(client, id, policyVersion, policy.rows[0].config || {})
    if (!planId) {
      return envelope(true, "ok", { planId: null, primaryFocus: null, plan: [], aiAvailable: aiAvailable() }, null)
    }
    return planView(client, planId, policyVersion)
  })
}

async function dueConfusion(db) {
  const pair = await db.query(
    `SELECT pair_id, label_a, label_b, key_a, direction_a, key_b, direction_b,
            confusion_type, graded_count, success_count, confusion_count, pending_sides, serving_probe_id
     FROM skill_trainer.confusion_pairs
     WHERE learner_key = 'default' AND next_due_at IS NOT NULL AND next_due_at <= NOW()
     ORDER BY next_due_at
     LIMIT 1`,
  )
  const row = pair.rows[0]
  if (!row) return null
  const side = Array.isArray(row.pending_sides) && row.pending_sides[0] ? row.pending_sides[0] : "a"
  const probe = await db.query(
    `SELECT probe_id, prompt, expected_text, side
     FROM skill_trainer.confusion_probes
     WHERE probe_id = $1 OR (pair_id = $2 AND side = $3)
     ORDER BY (probe_id = $1) DESC, last_served_at NULLS FIRST, ordinal
     LIMIT 1`,
    [row.serving_probe_id, row.pair_id, side],
  )
  const picked = probe.rows[0]
  if (!picked) return null
  return {
    pairId: row.pair_id,
    labelA: row.label_a,
    labelB: row.label_b,
    keyA: row.key_a,
    directionA: row.direction_a,
    keyB: row.key_b,
    directionB: row.direction_b,
    confusionType: row.confusion_type,
    gradedCount: row.graded_count,
    successCount: row.success_count,
    confusionCount: row.confusion_count,
    probe: { probeId: picked.probe_id, prompt: picked.prompt, expectedReference: picked.expected_text, side: picked.side },
  }
}

export async function getProgress(request) {
  const code = domainCode(request)
  const id = await domainId(code)
  if (!id) return validationError("unknown domain_code")
  const skills = await query(
    `SELECT id, stable_key, canonical_form, meaning, category, tier
     FROM skill_trainer.skill_concepts
     WHERE domain_id = $1 AND status = 'active'
     ORDER BY stable_key`,
    [id],
  )
  const quiz = await query(
    `SELECT count(*)::int AS attempts,
            count(*) FILTER (WHERE outcome = 'success')::int AS successes
     FROM skill_trainer.quiz_attempts
     WHERE learner_key = 'default'`,
  )
  const board = await quizBoard()
  const week = await weeklySummary(id)
  const review = await reviewCounts(id)
  const evidence = await query(
    `SELECT skill_id, capability, count(*)::int AS graded,
            count(*) FILTER (WHERE outcome = 'success')::int AS success
     FROM skill_trainer.effective_capability_evidence
     GROUP BY skill_id, capability`,
  )
  const diagnoses = await query(
    `SELECT skill_id, type, status, severity, confidence
     FROM skill_trainer.weakness_diagnoses
     WHERE learner_key = 'default'`,
  )
  const talk = await query(
    `SELECT count(*)::int AS sessions,
            coalesce(sum(self_question_count), 0)::int AS self_question,
            coalesce(sum(follow_up_count), 0)::int AS follow_up,
            coalesce(sum(error_handling_count), 0)::int AS error_handling,
            coalesce(sum(freeze_count), 0)::int AS freeze,
            coalesce(sum(japanese_fallback_count), 0)::int AS japanese
     FROM skill_trainer.conversation_sessions
     WHERE domain_id = $1`,
    [id],
  )
  const graders = await query(
    `SELECT source, count(*)::int AS count
     FROM skill_trainer.grading_observations
     GROUP BY source`,
  )
  const recent = await query(
    `SELECT qa.answered_at, qa.outcome, qa.item_key, qi.prompt,
            (SELECT o->>'text' FROM jsonb_array_elements(qi.options) o WHERE o->>'id' = qa.selected_option_id LIMIT 1) AS selected_text,
            (SELECT o->>'text' FROM jsonb_array_elements(qi.options) o WHERE o->>'id' = qa.correct_option_id LIMIT 1) AS correct_text
     FROM skill_trainer.quiz_attempts qa
     JOIN skill_trainer.quiz_items qi
       ON qi.item_key = qa.item_key AND qi.option_set_version = qa.option_set_version
     WHERE qa.learner_key = 'default'
     ORDER BY qa.answered_at DESC
     LIMIT 8`,
  )
  return envelope(
    true,
    "ok",
    {
      skills: skills.rows.map((row) => ({
        skillId: row.id,
        skillKey: row.stable_key,
        canonicalForm: row.canonical_form,
        meaning: row.meaning,
        category: row.category,
        tier: row.tier,
        capabilities: evidence.rows.filter((item) => String(item.skill_id) === String(row.id)).map((item) => ({
          capability: item.capability,
          graded: item.graded,
          success: item.success,
        })),
        diagnoses: diagnoses.rows.filter((item) => String(item.skill_id) === String(row.id)).map((item) => ({
          type: item.type,
          status: item.status,
          severity: item.severity,
          confidence: item.confidence,
        })),
      })),
      weeklySummary: week,
      confusionPairs: board.pairs,
      confusionWatchCount: board.confusionWatchCount,
      masteredPromptCount: review.mastered,
      recheckDueCount: review.recheck,
      graderSources: graders.rows,
      quickQuiz: {
        attempts: quiz.rows[0].attempts,
        successes: quiz.rows[0].successes,
        stableCount: board.stableCount,
        itemCount: board.itemCount,
        pairs: board.pairs,
        skills: board.skills,
        recent: recent.rows.map((row) => ({
          answeredAt: row.answered_at,
          outcome: row.outcome,
          itemKey: row.item_key,
          prompt: row.prompt,
          selectedText: row.selected_text,
          correctText: row.correct_text,
        })),
      },
      talkSummary: {
        totalSessions: talk.rows[0].sessions,
        totalSelfQuestionCount: talk.rows[0].self_question,
        totalFollowUpCount: talk.rows[0].follow_up,
        totalErrorHandlingCount: talk.rows[0].error_handling,
        totalFreezeCount: talk.rows[0].freeze,
        totalJapaneseFallbackCount: talk.rows[0].japanese,
      },
      aiAvailable: aiAvailable(),
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
            count(*)::int AS graded
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
  const newly = current.filter((row) => stableSkill(row) && !prior.some((item) => item.id === row.id && stableSkill(item)))
  const overcome = await query(
    `SELECT sc.canonical_form, sc.meaning
     FROM skill_trainer.weakness_diagnoses wd
     JOIN skill_trainer.skill_concepts sc ON sc.id = wd.skill_id
     WHERE wd.status = 'resolved' AND wd.resolved_at >= $1 AND wd.resolved_at < $2 AND sc.domain_id = $3
     ORDER BY wd.resolved_at DESC`,
    [start, end, domainId],
  )
  const focus = await query(
    `SELECT sc.canonical_form, sc.meaning
     FROM skill_trainer.weakness_diagnoses wd
     JOIN skill_trainer.skill_concepts sc ON sc.id = wd.skill_id
     WHERE wd.status = 'active' AND sc.domain_id = $1
     ORDER BY wd.severity DESC, sc.id
     LIMIT 3`,
    [domainId],
  )
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
    overcome: overcome.rows.map((row) => ({ phrase: phrase(row.canonical_form), meaning: row.meaning })),
    focus: focus.rows.map((row) => ({ phrase: phrase(row.canonical_form), meaning: row.meaning })),
  }
}

async function reviewCounts(domainId) {
  const reset = `COALESCE((SELECT max(requested_at) FROM skill_trainer.review_resets WHERE learner_key = 'default' AND domain_id = ${Number(domainId)}), '-infinity'::timestamptz)`
  const counted = await query(
    `SELECT count(*)::int AS mastered
     FROM (
       SELECT DISTINCT re.prompt
       FROM skill_trainer.capability_evidence ce
       JOIN skill_trainer.training_attempts ta ON ta.attempt_id = ce.training_attempt_id
       JOIN skill_trainer.rendered_exercises re ON re.exercise_instance_id = ta.exercise_instance_id
       WHERE ${inDomain("ta", domainId)}
         AND ce.outcome = 'success' AND ce.observed_at > ${reset}
         AND NOT EXISTS (
           SELECT 1 FROM skill_trainer.capability_evidence relapsed
           JOIN skill_trainer.training_attempts relapsed_attempt ON relapsed_attempt.attempt_id = relapsed.training_attempt_id
           JOIN skill_trainer.rendered_exercises relapsed_render ON relapsed_render.exercise_instance_id = relapsed_attempt.exercise_instance_id
           WHERE relapsed_render.prompt = re.prompt AND relapsed.outcome = 'failure' AND relapsed.observed_at > ce.observed_at
         )
     ) mastered`,
  )
  const due = await query(
    `SELECT count(DISTINCT prior_render.prompt)::int AS due
     FROM skill_trainer.capability_evidence prior_success
     JOIN skill_trainer.training_attempts prior_attempt ON prior_attempt.attempt_id = prior_success.training_attempt_id
     JOIN skill_trainer.rendered_exercises prior_render ON prior_render.exercise_instance_id = prior_attempt.exercise_instance_id
     WHERE prior_success.outcome = 'success' AND prior_success.observed_at <= ${reset}
       AND ${inDomain("prior_attempt", domainId)}
       AND NOT EXISTS (
         SELECT 1 FROM skill_trainer.capability_evidence after_reset
         JOIN skill_trainer.training_attempts after_attempt ON after_attempt.attempt_id = after_reset.training_attempt_id
         JOIN skill_trainer.rendered_exercises after_render ON after_render.exercise_instance_id = after_attempt.exercise_instance_id
         WHERE after_render.prompt = prior_render.prompt AND after_reset.observed_at > ${reset}
       )`,
  )
  return { mastered: counted.rows[0].mastered, recheck: due.rows[0].due }
}
