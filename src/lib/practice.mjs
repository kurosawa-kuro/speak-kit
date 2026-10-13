import { randomUUID } from "node:crypto"
import { envelope, validationError } from "./envelope.mjs"
import { query } from "./db.mjs"
import { hashParts } from "./hash.mjs"
import { aiAvailability } from "./ai/isEnabled.mjs"
import { duePractice } from "./boundary.mjs"
import { loadPolicy } from "./learning.mjs"

const MODES = new Set([
  "controlled_recall",
  "recognition",
  "slot_replacement",
  "contrast_drill",
  "free_production",
])
const GENERATOR = "exercise-materializer-v1"
const ENGLISH = "english_conversation"

function text(request, key) {
  const value = request?.[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "")
}

function resetAt(domainId) {
  return `COALESCE((SELECT max(requested_at) FROM skill_trainer.review_resets
    WHERE learner_key = 'default' AND domain_id = ${Number(domainId)}), '-infinity'::timestamptz)`
}

function mastered(domainId) {
  const reset = resetAt(domainId)
  return `EXISTS (
    SELECT 1
    FROM skill_trainer.capability_evidence mastered
    JOIN skill_trainer.training_attempts mastered_attempt
      ON mastered_attempt.attempt_id = mastered.training_attempt_id
    JOIN skill_trainer.rendered_exercises mastered_render
      ON mastered_render.exercise_instance_id = mastered_attempt.exercise_instance_id
    WHERE mastered_render.prompt = ed.prompt_spec->>'prompt'
      AND mastered.outcome = 'success'
      AND mastered.observed_at > ${reset}
      AND NOT EXISTS (
        SELECT 1
        FROM skill_trainer.capability_evidence relapsed
        JOIN skill_trainer.training_attempts relapsed_attempt
          ON relapsed_attempt.attempt_id = relapsed.training_attempt_id
        JOIN skill_trainer.rendered_exercises relapsed_render
          ON relapsed_render.exercise_instance_id = relapsed_attempt.exercise_instance_id
        WHERE relapsed_render.prompt = mastered_render.prompt
          AND relapsed.outcome = 'failure'
          AND relapsed.observed_at > mastered.observed_at
      )
  )`
}

export async function getPractice(request) {
  if (!isUuid(text(request, "practice_id"))) return validationError("practice_id must be a UUID")
  const mode = text(request, "training_mode")
  if (!mode) return validationError("training_mode is required")
  if (!MODES.has(mode)) return validationError("unsupported free-practice training_mode")
  const code = text(request, "domain_code") || ENGLISH
  const domain = await query("SELECT id FROM skill_trainer.domains WHERE code = $1", [code])
  const domainId = domain.rows[0]?.id
  if (!domainId) return validationError("unknown domain_code")
  if (code === ENGLISH) {
    const confusionPractice = await duePractice(await aiAvailability())
    if (confusionPractice) return envelope(true, "ok", confusionPractice, null)
  }
  const policyVersion = (await loadPolicy()).version
  const practiceId = text(request, "practice_id")
  const skillKey = text(request, "skill_key")
  const reset = resetAt(domainId)
  const found = await query(
    `SELECT ed.exercise_key, ed.version, ed.training_mode, ed.target_capability,
            sc.stable_key, sc.canonical_form, sc.meaning, sc.category,
            ed.prompt_spec->>'prompt' AS prompt, ed.reference_examples->>0 AS reference,
            ed.accepted_variants, ed.rubric, ed.modality
     FROM skill_trainer.exercise_definitions ed
     JOIN skill_trainer.skill_concepts sc ON sc.id = ed.target_skill_id
     WHERE ed.status = 'active' AND sc.status = 'active' AND sc.phase = 1
       AND sc.domain_id = $4
       AND ed.training_mode = $1
       AND NOT ${mastered(domainId)}
     ORDER BY (sc.stable_key = $2::text) IS TRUE DESC,
              CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM skill_trainer.capability_evidence prior_success
                  JOIN skill_trainer.training_attempts prior_attempt
                    ON prior_attempt.attempt_id = prior_success.training_attempt_id
                  JOIN skill_trainer.rendered_exercises prior_render
                    ON prior_render.exercise_instance_id = prior_attempt.exercise_instance_id
                  WHERE prior_render.prompt = ed.prompt_spec->>'prompt'
                    AND prior_success.outcome = 'success'
                    AND prior_success.observed_at <= ${reset}
                    AND NOT EXISTS (
                      SELECT 1
                      FROM skill_trainer.capability_evidence after_reset
                      JOIN skill_trainer.training_attempts after_attempt
                        ON after_attempt.attempt_id = after_reset.training_attempt_id
                      JOIN skill_trainer.rendered_exercises after_render
                        ON after_render.exercise_instance_id = after_attempt.exercise_instance_id
                      WHERE after_render.prompt = prior_render.prompt
                        AND after_reset.observed_at > ${reset}
                    )
                ) THEN 0
                WHEN EXISTS (
                  SELECT 1
                  FROM skill_trainer.rendered_exercises seen
                  JOIN skill_trainer.training_attempts seen_attempt
                    ON seen_attempt.exercise_instance_id = seen.exercise_instance_id
                  WHERE seen.prompt = ed.prompt_spec->>'prompt'
                ) THEN 2
                ELSE 1
              END,
              md5(ed.exercise_key || $3), ed.version DESC
     LIMIT 1`,
    [mode, skillKey, practiceId, domainId],
  )
  const definition = found.rows[0]
  if (!definition?.prompt || !definition.reference) {
    return envelope(false, "no_exercise", {}, { message: "このモードで、まだ正解していない問題はありません。正解済みは繰り返しません。覚えたものを出すには、記録の「覚えたものを再チェック」を押します。" })
  }
  const materializationKey = hashParts(["free-practice", practiceId, mode, policyVersion])
  const instanceId = randomUUID()
  const renderedHash = hashParts([definition.prompt, definition.reference, JSON.stringify(definition.rubric), GENERATOR, policyVersion])
  await query(
    `INSERT INTO skill_trainer.rendered_exercises
       (exercise_instance_id, materialization_key, plan_item_id, exercise_key, exercise_version,
        prompt, expected_reference, accepted_variants, rubric_snapshot, resolved_slots,
        modality, generator_version, policy_version, content_hash)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, '{}'::jsonb, $9, $10, $11, $12)
     ON CONFLICT (materialization_key) DO NOTHING`,
    [
      instanceId,
      materializationKey,
      definition.exercise_key,
      definition.version,
      definition.prompt,
      definition.reference,
      JSON.stringify(definition.accepted_variants || []),
      JSON.stringify(definition.rubric || {}),
      definition.modality,
      GENERATOR,
      policyVersion,
      renderedHash,
    ],
  )
  const stored = await query(
    `SELECT exercise_instance_id FROM skill_trainer.rendered_exercises WHERE materialization_key = $1`,
    [materializationKey],
  )
  return envelope(true, "ok", {
    practiceId,
    source: "free_practice",
    policyVersion,
    trainingMode: definition.training_mode,
    capability: definition.target_capability,
    skill: {
      skillKey: definition.stable_key,
      canonicalForm: definition.canonical_form,
      meaning: definition.meaning,
      category: definition.category,
    },
    exercise: {
      exerciseKey: definition.exercise_key,
      exerciseVersion: definition.version,
      exerciseInstanceId: stored.rows[0].exercise_instance_id,
      prompt: definition.prompt,
      expectedReference: definition.reference,
      modality: definition.modality,
    },
    ...(await aiAvailability()),
  }, null)
}
