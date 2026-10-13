import { contentHash } from "./derive.mjs"

// 教材を DB に書く SQL はここだけに置く。YAML の同期、候補の承認、混同ペアの登録が同じ関数を呼ぶ。
// どれも client を受け取り、呼び出し側のトランザクションに乗る。

const DOMAIN = "(SELECT id FROM skill_trainer.domains WHERE code = 'english_conversation')"

export function insertSkill(client, skill, reviewSource) {
  return client.query(
    `INSERT INTO skill_trainer.skill_concepts
       (stable_key, canonical_form, meaning, category, intent, phase, tier, direction,
        concept_kind, status, review_source, domain_id)
     VALUES ($1, $2, $3, $4, $5, 1, $6, 'OUTPUT', $7, $8, $9, ${DOMAIN})
     RETURNING id`,
    [skill.key, skill.form, skill.meaning, skill.category, skill.intent ?? null, skill.tier, skill.kind, skill.status, reviewSource],
  )
}

export function updateSkill(client, skill) {
  return client.query(
    `UPDATE skill_trainer.skill_concepts
     SET canonical_form = $2, meaning = $3, category = $4, intent = $5, tier = $6,
         concept_kind = $7, status = $8
     WHERE stable_key = $1`,
    [skill.key, skill.form, skill.meaning, skill.category, skill.intent ?? null, skill.tier, skill.kind, skill.status],
  )
}

/** 練習問題は、採点の版ごとの採点契約（rubric:<版>）を指す。 */
export async function insertDefinition(client, definition, skillKey, version, status) {
  const contractKey = `rubric:${definition.rubric.rubric_version}`
  await client.query(
    `INSERT INTO skill_trainer.assessment_contracts
       (contract_key, version, required_dimensions, response_modes, deterministic_policy,
        ai_observation_schema, evidence_policy, domain_id)
     VALUES ($1, 1, $2, '["free_text"]'::jsonb,
             '{"kind":"normalized_exact_or_accepted_variant","expected_reference":true,"accepted_variants":true}'::jsonb,
             '{"meaning_match":"boolean","speech_act_match":"boolean","comprehensibility":"enum","target_pattern_status":"enum","issues":"fact_array"}'::jsonb,
             'versioned_reducer', ${DOMAIN})
     ON CONFLICT DO NOTHING`,
    [contractKey, JSON.stringify(definition.rubric.required_dimensions)],
  )
  await client.query(
    `INSERT INTO skill_trainer.exercise_definitions
       (exercise_key, version, training_mode, target_skill_id, target_capability, prompt_spec,
        reference_examples, accepted_variants, rubric, difficulty, modality, status, content_hash,
        assessment_contract_key, assessment_contract_version)
     VALUES ($1, $2, $3, (SELECT id FROM skill_trainer.skill_concepts WHERE stable_key = $4), $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, 1)`,
    [
      definition.exerciseKey, version, definition.trainingMode, skillKey, definition.targetCapability,
      JSON.stringify(definition.promptSpec), JSON.stringify(definition.referenceExamples),
      JSON.stringify(definition.acceptedVariants), JSON.stringify(definition.rubric), definition.difficulty,
      definition.modality, status, contentHash(definition), contractKey,
    ],
  )
}

export function setDefinitionStatus(client, exerciseKey, version, status) {
  return client.query(
    "UPDATE skill_trainer.exercise_definitions SET status = $3 WHERE exercise_key = $1 AND version = $2",
    [exerciseKey, version, status],
  )
}

export function insertQuiz(client, quiz, skillKey, version, status) {
  return client.query(
    `INSERT INTO skill_trainer.quiz_items
       (item_key, option_set_version, probe_id, pair_id, capability, prompt, options,
        correct_option_id, status, quiz_type, skill_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             (SELECT id FROM skill_trainer.skill_concepts WHERE stable_key = $11))`,
    [
      quiz.itemKey, version, quiz.probeId ?? null, quiz.pairId ?? null, quiz.capability, quiz.prompt,
      JSON.stringify(quiz.options), quiz.correctOptionId, status, quiz.quizType, skillKey,
    ],
  )
}

export function setQuizStatus(client, itemKey, version, status) {
  return client.query(
    "UPDATE skill_trainer.quiz_items SET status = $3 WHERE item_key = $1 AND option_set_version = $2",
    [itemKey, version, status],
  )
}

/** pair は derivePair の pair。同じ二つのラベルのペアがすでにあれば書かずに false を返す。 */
export async function insertPair(client, pair) {
  const inserted = await client.query(
    `INSERT INTO skill_trainer.confusion_pairs
       (pair_id, label_a, label_b, skill_key_a, skill_key_b, key_a, direction_a,
        key_b, direction_b, confusion_type, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (label_a, label_b) DO NOTHING`,
    [
      pair.pairId, pair.labelA, pair.labelB, pair.skillKeyA, pair.skillKeyB, pair.keyA, pair.directionA,
      pair.keyB, pair.directionB, pair.confusionType, pair.source,
    ],
  )
  return inserted.rowCount > 0
}

export function updatePair(client, pair) {
  return client.query(
    `UPDATE skill_trainer.confusion_pairs
     SET label_a = $2, label_b = $3, skill_key_a = $4, skill_key_b = $5, key_a = $6,
         direction_a = $7, key_b = $8, direction_b = $9, confusion_type = $10
     WHERE pair_id = $1`,
    [pair.pairId, pair.labelA, pair.labelB, pair.skillKeyA, pair.skillKeyB, pair.keyA, pair.directionA, pair.keyB, pair.directionB, pair.confusionType],
  )
}

export function insertProbe(client, pairId, probe) {
  return client.query(
    `INSERT INTO skill_trainer.confusion_probes (probe_id, pair_id, side, ordinal, prompt, expected_text)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [probe.probeId, pairId, probe.side, probe.ordinal, probe.prompt, probe.expectedText],
  )
}

/** 表現 1 つ（YAML の表現と同じ形）から導いた練習問題とクイズを、すべて新しく書く。 */
export async function insertExpression(client, expression, derived, reviewSource) {
  const skill = await insertSkill(client, expression, reviewSource)
  for (const definition of derived.definitions) await insertDefinition(client, definition, expression.key, 1, expression.status)
  for (const quiz of derived.quizzes) await insertQuiz(client, quiz, expression.key, 1, expression.status)
  return skill.rows[0].id
}

/** 混同ペア 1 つ（YAML のペアと同じ形）から導いた確認問題とクイズを、すべて新しく書く。 */
export async function insertPairContent(client, derived) {
  if (!(await insertPair(client, derived.pair))) return false
  for (const probe of derived.probes) await insertProbe(client, derived.pair.pairId, probe)
  for (const quiz of derived.quizzes) await insertQuiz(client, quiz, null, 1, "active")
  return true
}
