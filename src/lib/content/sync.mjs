import { contentHash, deriveDefinitions, derivePair, deriveSkillQuizzes, stableJson } from "./derive.mjs"
import { latestByKey, loadState } from "./state.mjs"

const DOMAIN = "(SELECT id FROM skill_trainer.domains WHERE code = 'english_conversation')"
const CANDIDATE_SOURCE = /^owner candidate review/

const same = (a, b) => stableJson(a) === stableJson(b)

function definitionContent(row, skillKey) {
  return {
    skillKey,
    trainingMode: row.trainingMode ?? row.training_mode,
    targetCapability: row.targetCapability ?? row.target_capability,
    promptSpec: row.promptSpec ?? row.prompt_spec,
    referenceExamples: row.referenceExamples ?? row.reference_examples,
    acceptedVariants: row.acceptedVariants ?? row.accepted_variants,
    rubric: row.rubric,
    difficulty: row.difficulty,
    modality: row.modality,
  }
}

function quizContent(row, skillKey) {
  return {
    skillKey,
    quizType: row.quizType ?? row.quiz_type,
    capability: row.capability,
    prompt: row.prompt,
    options: row.options,
    correctOptionId: row.correctOptionId ?? row.correct_option_id,
    probeId: row.probeId ?? row.probe_id ?? null,
    pairId: row.pairId ?? row.pair_id ?? null,
  }
}

function describeChange(before, after) {
  return Object.keys(after)
    .filter((key) => !same(before[key], after[key]))
    .map((key) => `${key}: ${JSON.stringify(before[key])} → ${JSON.stringify(after[key])}`)
    .join(" / ")
}

/** YAML（loadContent の結果）と DB を比べ、反映する変更の一覧を作る。DB には書かない。 */
export async function planSync(db, content, { catalogOnly = false } = {}) {
  const state = await loadState(db)
  const changes = []
  const notices = []
  const blockers = []
  const add = (kind, label, detail, apply) => changes.push({ kind, label, detail, apply })

  const skillByKey = new Map(state.skills.map((row) => [row.stable_key, row]))
  const skillKeyById = new Map(state.skills.map((row) => [Number(row.id), row.stable_key]))
  const latestDefinitions = latestByKey(state.definitions, "exercise_key", "version")
  const latestQuizzes = latestByKey(state.quizzes, "item_key", "option_set_version")
  const yamlKeys = new Set(content.expressions.map((expression) => expression.key))

  const syncDefinition = (desired, skillKey, status) => {
    const current = latestDefinitions.get(desired.exerciseKey)
    const label = `練習問題 ${desired.exerciseKey}`
    if (!current) {
      add("追加", label, `${skillKey} の ${desired.trainingMode}「${desired.promptSpec.prompt}」`, (client) => insertDefinition(client, desired, skillKey, 1, status))
      return
    }
    const currentKey = skillKeyById.get(Number(current.target_skill_id))
    const before = definitionContent(current, currentKey)
    const after = definitionContent(desired, skillKey)
    if (!same(before, after)) {
      const version = current.version + 1
      add("変更", label, `版 ${current.version} → ${version}（${describeChange(before, after)}）`, async (client) => {
        await insertDefinition(client, desired, skillKey, version, status)
        await client.query(
          `UPDATE skill_trainer.exercise_definitions SET status = 'retired'
           WHERE exercise_key = $1 AND version < $2 AND status = 'active'`,
          [desired.exerciseKey, version],
        )
      })
      return
    }
    if (current.status !== status) {
      add(status === "retired" ? "停止" : "変更", label, `status: ${current.status} → ${status}`, (client) => setDefinitionStatus(client, desired.exerciseKey, current.version, status))
    }
    const olderActive = state.definitions.filter((row) => row.exercise_key === desired.exerciseKey && row.version < current.version && row.status === "active")
    for (const row of olderActive) {
      add("停止", `練習問題 ${row.exercise_key} 版 ${row.version}`, "古い版が active のまま", (client) => setDefinitionStatus(client, row.exercise_key, row.version, "retired"))
    }
  }

  const syncQuiz = (desired, skillKey, status) => {
    const current = latestQuizzes.get(desired.itemKey)
    const label = `クイズ ${desired.itemKey}`
    if (!current) {
      add("追加", label, `「${desired.prompt}」`, (client) => insertQuiz(client, desired, skillKey, 1, status))
      return
    }
    const currentKey = current.skill_id == null ? null : skillKeyById.get(Number(current.skill_id))
    const before = quizContent(current, currentKey)
    const after = quizContent(desired, skillKey)
    if (!same(before, after)) {
      const version = current.option_set_version + 1
      add("変更", label, `選択肢の版 ${current.option_set_version} → ${version}（${describeChange(before, after)}）`, async (client) => {
        await insertQuiz(client, desired, skillKey, version, status)
        await client.query(
          `UPDATE skill_trainer.quiz_items SET status = 'retired'
           WHERE item_key = $1 AND option_set_version < $2 AND status = 'active'`,
          [desired.itemKey, version],
        )
      })
      return
    }
    if (current.status !== status) {
      add(status === "retired" ? "停止" : "変更", label, `status: ${current.status} → ${status}`, (client) => setQuizStatus(client, desired.itemKey, current.option_set_version, status))
    }
  }

  const retireLeftovers = (skillKey, keepDefinitions, keepQuizzes) => {
    const skill = skillByKey.get(skillKey)
    if (!skill) return
    for (const row of latestDefinitions.values()) {
      if (Number(row.target_skill_id) === Number(skill.id) && !keepDefinitions.has(row.exercise_key) && row.status === "active") {
        add("停止", `練習問題 ${row.exercise_key}`, `${skillKey} の YAML から外れた`, (client) => setDefinitionStatus(client, row.exercise_key, row.version, "retired"))
      }
    }
    for (const row of latestQuizzes.values()) {
      if (row.skill_id != null && Number(row.skill_id) === Number(skill.id) && !keepQuizzes.has(row.item_key) && row.status === "active") {
        add("停止", `クイズ ${row.item_key}`, `${skillKey} の YAML から外れた`, (client) => setQuizStatus(client, row.item_key, row.option_set_version, "retired"))
      }
    }
  }

  for (const expression of content.expressions) {
    const desired = {
      canonical_form: expression.form,
      meaning: expression.meaning,
      category: expression.category,
      intent: expression.intent ?? null,
      tier: expression.tier,
      concept_kind: expression.kind,
      status: expression.status,
    }
    const current = skillByKey.get(expression.key)
    if (!current) {
      add("追加", `表現 ${expression.key}`, `「${expression.form}」${expression.meaning}`, (client) => client.query(
        `INSERT INTO skill_trainer.skill_concepts
           (stable_key, canonical_form, meaning, category, intent, phase, tier, direction,
            concept_kind, status, review_source, domain_id)
         VALUES ($1, $2, $3, $4, $5, 1, $6, 'OUTPUT', $7, $8, 'data/yaml', ${DOMAIN})`,
        [expression.key, desired.canonical_form, desired.meaning, desired.category, desired.intent, desired.tier, desired.concept_kind, desired.status],
      ))
    } else {
      const before = Object.fromEntries(Object.keys(desired).map((key) => [key, current[key]]))
      if (!same(before, desired)) {
        const retiring = current.status === "active" && desired.status === "retired"
        add(retiring ? "停止" : "変更", `表現 ${expression.key}`, describeChange(before, desired), (client) => client.query(
          `UPDATE skill_trainer.skill_concepts
           SET canonical_form = $2, meaning = $3, category = $4, intent = $5, tier = $6,
               concept_kind = $7, status = $8
           WHERE stable_key = $1`,
          [expression.key, desired.canonical_form, desired.meaning, desired.category, desired.intent, desired.tier, desired.concept_kind, desired.status],
        ))
      }
    }
    const definitions = deriveDefinitions(expression)
    for (const definition of definitions) syncDefinition(definition, expression.key, expression.status)
    const quizzes = deriveSkillQuizzes(expression)
    for (const quiz of quizzes) syncQuiz(quiz, expression.key, expression.status)
    retireLeftovers(expression.key, new Set(definitions.map((row) => row.exerciseKey)), new Set(quizzes.map((row) => row.itemKey)))
  }

  for (const skill of state.skills) {
    if (yamlKeys.has(skill.stable_key)) continue
    if (CANDIDATE_SOURCE.test(skill.review_source || "")) {
      notices.push(`表現 ${skill.stable_key} は会話の候補から画面で追加されたもので、YAML にありません。そのままにします（npm run data:export で YAML に取り込めます）`)
      continue
    }
    if (skill.status === "active") {
      add("停止", `表現 ${skill.stable_key}`, "YAML から消えた", (client) => client.query(
        "UPDATE skill_trainer.skill_concepts SET status = 'retired' WHERE stable_key = $1",
        [skill.stable_key],
      ))
    }
    retireLeftovers(skill.stable_key, new Set(), new Set())
  }

  const pairById = new Map(state.pairs.map((row) => [row.pair_id, row]))
  const yamlPairIds = new Set()
  for (const entry of content.pairs) {
    const { pair, probes, quizzes } = derivePair(entry)
    yamlPairIds.add(pair.pairId)
    const current = pairById.get(pair.pairId)
    const label = `混同ペア ${pair.labelA} / ${pair.labelB}`
    const fields = {
      label_a: pair.labelA,
      label_b: pair.labelB,
      skill_key_a: pair.skillKeyA,
      skill_key_b: pair.skillKeyB,
      key_a: pair.keyA,
      direction_a: pair.directionA,
      key_b: pair.keyB,
      direction_b: pair.directionB,
      confusion_type: pair.confusionType,
    }
    if (!current) {
      if (pair.source !== "catalog") {
        if (catalogOnly) {
          notices.push(`${entry._at} ${label} は画面から追加されたペア（${pair.source}）なので飛ばしました`)
          continue
        }
        blockers.push(`${entry._at} 画面から追加された種類（${pair.source}）のペアは、YAML からは足せません。source を消してください`)
        continue
      }
      add("追加", label, `${probes.length} 問の確認問題、${quizzes.length} 問のクイズ`, (client) => client.query(
        `INSERT INTO skill_trainer.confusion_pairs
           (pair_id, learner_key, label_a, label_b, skill_key_a, skill_key_b, key_a, direction_a,
            key_b, direction_b, confusion_type, source)
         VALUES ($1, 'default', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'catalog')`,
        [pair.pairId, ...Object.values(fields)],
      ))
    } else {
      const before = Object.fromEntries(Object.keys(fields).map((key) => [key, current[key]]))
      if (!same(before, fields)) {
        if (current.source !== "catalog") {
          notices.push(`${entry._at} ${label} は画面から追加されたペア（${current.source}）なので、説明の変更は反映しません`)
        } else {
          add("変更", label, describeChange(before, fields), (client) => client.query(
            `UPDATE skill_trainer.confusion_pairs
             SET label_a = $2, label_b = $3, skill_key_a = $4, skill_key_b = $5, key_a = $6,
                 direction_a = $7, key_b = $8, direction_b = $9, confusion_type = $10
             WHERE pair_id = $1`,
            [pair.pairId, ...Object.values(fields)],
          ))
        }
      }
    }
    const currentProbes = state.probes.filter((row) => row.pair_id === pair.pairId)
    const probeById = new Map(currentProbes.map((row) => [row.probe_id, row]))
    for (const probe of probes) {
      const existing = probeById.get(probe.probeId)
      if (!existing) {
        if (current && current.source !== "catalog") continue
        add("追加", `確認問題（${pair.labelA} / ${pair.labelB} の ${probe.side} 側）`, `「${probe.prompt}」→「${probe.expectedText}」`, (client) => client.query(
          `INSERT INTO skill_trainer.confusion_probes (probe_id, pair_id, side, ordinal, prompt, expected_text)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [probe.probeId, pair.pairId, probe.side, probe.ordinal, probe.prompt, probe.expectedText],
        ))
        continue
      }
      const before = { side: existing.side, ordinal: existing.ordinal, prompt: existing.prompt, answer: existing.expected_text }
      const after = { side: probe.side, ordinal: probe.ordinal, prompt: probe.prompt, answer: probe.expectedText }
      if (!same(before, after)) {
        blockers.push(`${entry._at} ${label} の確認問題「${existing.prompt}」は書き換えられません（回答の記録が指しています）。元に戻し、直した文は id を書かずに新しい確認問題として足してください（${describeChange(before, after)}）`)
      }
    }
    for (const existing of currentProbes) {
      if (!probes.some((probe) => probe.probeId === existing.probe_id)) {
        blockers.push(`${entry._at} ${label} の確認問題「${existing.prompt}」が YAML にありません。確認問題は消せないので、元に戻してください`)
      }
    }
    if (!current || current.source === "catalog") {
      for (const quiz of quizzes) syncQuiz(quiz, null, "active")
    }
  }
  for (const pair of state.pairs) {
    if (yamlPairIds.has(pair.pair_id)) continue
    if (pair.source === "catalog") {
      blockers.push(`混同ペア ${pair.label_a} / ${pair.label_b}（id ${pair.pair_id}）が YAML にありません。混同ペアは止められないので、元に戻してください`)
    } else {
      notices.push(`混同ペア ${pair.label_a} / ${pair.label_b} は画面から追加されたもの（${pair.source}）で、YAML にありません。そのままにします（npm run data:export で YAML に取り込めます）`)
    }
  }
  return { changes, notices, blockers }
}

async function insertDefinition(client, definition, skillKey, version, status) {
  const contractKey = `adaptive:${definition.exerciseKey}`
  await client.query(
    `INSERT INTO skill_trainer.assessment_contracts
       (contract_key, version, required_dimensions, response_modes, deterministic_policy,
        ai_observation_schema, evidence_policy, domain_id)
     VALUES ($1, $2, $3, '["free_text"]'::jsonb,
             '{"kind":"normalized_exact_or_accepted_variant","expected_reference":true,"accepted_variants":true}'::jsonb,
             '{"meaning_match":"boolean","speech_act_match":"boolean","comprehensibility":"enum","target_pattern_status":"enum","issues":"fact_array"}'::jsonb,
             'versioned_reducer', ${DOMAIN})
     ON CONFLICT DO NOTHING`,
    [contractKey, version, JSON.stringify(definition.rubric.required_dimensions)],
  )
  await client.query(
    `INSERT INTO skill_trainer.exercise_definitions
       (exercise_key, version, training_mode, target_skill_id, target_capability, prompt_spec,
        reference_examples, accepted_variants, rubric, difficulty, modality, status, content_hash,
        assessment_contract_key, assessment_contract_version)
     VALUES ($1, $2, $3, (SELECT id FROM skill_trainer.skill_concepts WHERE stable_key = $4), $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, $2)`,
    [
      definition.exerciseKey, version, definition.trainingMode, skillKey, definition.targetCapability,
      JSON.stringify(definition.promptSpec), JSON.stringify(definition.referenceExamples),
      JSON.stringify(definition.acceptedVariants), JSON.stringify(definition.rubric), definition.difficulty,
      definition.modality, status, contentHash(definition), contractKey,
    ],
  )
}

function setDefinitionStatus(client, exerciseKey, version, status) {
  return client.query(
    "UPDATE skill_trainer.exercise_definitions SET status = $3 WHERE exercise_key = $1 AND version = $2",
    [exerciseKey, version, status],
  )
}

function insertQuiz(client, quiz, skillKey, version, status) {
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

function setQuizStatus(client, itemKey, version, status) {
  return client.query(
    "UPDATE skill_trainer.quiz_items SET status = $3 WHERE item_key = $1 AND option_set_version = $2",
    [itemKey, version, status],
  )
}

export async function applySync(client, plan) {
  for (const change of plan.changes) await change.apply(client)
}
