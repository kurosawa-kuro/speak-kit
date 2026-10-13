import { randomUUID } from "node:crypto"
import { aiEnabled } from "./ai/isEnabled.mjs"
import { envelope, validationError } from "./envelope.mjs"
import { query, withTransaction } from "./db.mjs"
import { quizBoard, quizRoute, sha256 } from "./quiz.mjs"

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
      dueConfusion: null,
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
    const existing = await client.query(
      `SELECT plan_id, policy_version FROM skill_trainer.training_plans
       WHERE learner_key = 'default' AND status = 'active' AND domain_id = $1`,
      [id],
    )
    if (existing.rows[0]) {
      return planView(client, existing.rows[0].plan_id, existing.rows[0].policy_version)
    }
    const policy = await client.query(
      `SELECT policy_version FROM skill_trainer.learning_policy_versions
       ORDER BY created_at DESC NULLS LAST LIMIT 1`,
    )
    const policyVersion = policy.rows[0]?.policy_version
    if (!policyVersion) {
      return envelope(true, "ok", { planId: null, primaryFocus: null, plan: [], aiAvailable: aiAvailable() }, null)
    }
    const picked = await client.query(
      `SELECT ed.exercise_key, ed.version, ed.training_mode, ed.target_capability, ed.target_skill_id,
              ed.prompt_spec->>'prompt' AS prompt, ed.reference_examples->>0 AS reference,
              ed.modality, ed.rubric, ed.accepted_variants,
              sc.stable_key
       FROM skill_trainer.exercise_definitions ed
       JOIN skill_trainer.skill_concepts sc ON sc.id = ed.target_skill_id
       WHERE ed.status = 'active' AND sc.status = 'active' AND sc.phase = 1 AND sc.domain_id = $1
         AND ed.prompt_spec->>'prompt' NOT LIKE '%{%'
         AND ed.prompt_spec->>'prompt' NOT LIKE '%}%'
       ORDER BY sc.stable_key, ed.exercise_key
       LIMIT 3`,
      [id],
    )
    if (!picked.rows.length) {
      return envelope(true, "ok", { planId: null, primaryFocus: null, plan: [], aiAvailable: aiAvailable() }, null)
    }
    const planId = randomUUID()
    const plannerKey = sha256(
      [policyVersion, new Date().toISOString().slice(0, 10), picked.rows.map((row) => row.exercise_key).join("|")].join("\u001f"),
    )
    await client.query(
      `INSERT INTO skill_trainer.training_plans
         (plan_id, learner_key, planner_key, policy_version, input_snapshot, status, domain_id)
       VALUES ($1, 'default', $2, $3, $4, 'active', $5)`,
      [
        planId,
        plannerKey,
        policyVersion,
        JSON.stringify({ selectedCount: picked.rows.length, selectionRule: "measure_catalog_v1" }),
        id,
      ],
    )
    let ordinal = 1
    for (const row of picked.rows) {
      const planItemId = randomUUID()
      const reference = row.reference || row.prompt
      await client.query(
        `INSERT INTO skill_trainer.training_plan_items
           (plan_item_id, plan_id, ordinal, purpose, skill_id, target_capability,
            exercise_key, exercise_version, training_mode, reason_code, selection_snapshot,
            dose, stop_condition)
         VALUES ($1, $2, $3, 'Measure', $4, $5, $6, $7, $8, 'evidence_gap', '{}'::jsonb, 1, '{}'::jsonb)`,
        [planItemId, planId, ordinal, row.target_skill_id, row.target_capability, row.exercise_key, row.version, row.training_mode],
      )
      ordinal += 1
      const instanceId = randomUUID()
      const material = sha256(`${row.exercise_key}:${row.version}:${row.prompt}`)
      await client.query(
        `INSERT INTO skill_trainer.rendered_exercises
           (exercise_instance_id, materialization_key, plan_item_id, exercise_key, exercise_version,
            prompt, expected_reference, accepted_variants, rubric_snapshot, modality,
            generator_version, policy_version, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'speak-kit-local', $11, $12)`,
        [
          instanceId,
          material,
          planItemId,
          row.exercise_key,
          row.version,
          row.prompt,
          reference,
          JSON.stringify(row.accepted_variants || []),
          JSON.stringify(row.rubric || {}),
          row.modality,
          policyVersion,
          sha256(`${row.prompt}\n${reference}`),
        ],
      )
    }
    return planView(client, planId, policyVersion)
  })
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
        capabilities: [],
        diagnoses: [],
      })),
      weeklySummary: {
        practiceDays: 0,
        answerCount: quiz.rows[0].attempts,
        talkSessions: 0,
        talkMinutes: 0,
        latencyNowMs: null,
        latencyBeforeMs: null,
        newlyStableCount: 0,
        newlyStable: [],
        overcomeCount: 0,
        overcome: [],
        focus: board.skills.slice(0, 3).map((skill) => ({ phrase: skill.form, meaning: skill.meaning })),
      },
      confusionPairs: [],
      confusionWatchCount: board.confusionWatchCount,
      masteredPromptCount: board.stableCount,
      recheckDueCount: 0,
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
        totalSessions: 0,
        totalSelfQuestionCount: 0,
        totalFollowUpCount: 0,
        totalErrorHandlingCount: 0,
        totalFreezeCount: 0,
        totalJapaneseFallbackCount: 0,
      },
      aiAvailable: aiAvailable(),
    },
    null,
  )
}
