import { createHash } from "node:crypto"

export const CATEGORIES = ["OUTPUT", "QUERY", "TIME", "ACTION", "ERROR_HANDLING"]
export const CATEGORY_FILES = {
  OUTPUT: "output",
  QUERY: "query",
  TIME: "time",
  ACTION: "action",
  ERROR_HANDLING: "error_handling",
}
export const TIERS = ["CORE", "TIER1"]
export const KINDS = ["pattern", "atomic_chunk"]
export const STATUSES = ["active", "retired"]
export const PAIR_TYPES = ["DIRECTION", "TIME", "SUBJECT", "INTENT", "MEANING", "REGISTER"]
export const EXTRA_RUBRICS = ["controlled-recall-v1", "controlled-recall-v2"]

const SIX = ["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]
const RETENTION = [
  { label: "1D", capability: "RETENTION_1D", days: 1, difficulty: 2 },
  { label: "7D", capability: "RETENTION_7D", days: 7, difficulty: 3 },
  { label: "30D", capability: "RETENTION_30D", days: 30, difficulty: 4 },
]

const md5 = (value) => createHash("md5").update(value).digest("hex")

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function contentHash(definition) {
  return createHash("sha256").update(stableJson({
    exerciseKey: definition.exerciseKey,
    trainingMode: definition.trainingMode,
    targetCapability: definition.targetCapability,
    promptSpec: definition.promptSpec,
    referenceExamples: definition.referenceExamples,
    rubric: definition.rubric,
    difficulty: definition.difficulty,
  })).digest("hex")
}

/** 参照元の migration と同じく、選択肢の ID は位置（correct / near1…）から決める。 */
export function skillOptionId(quizType, skillKey, slot) {
  return md5(`${quizType}${skillKey}|${slot}`).slice(0, 8)
}

export function probeOptionId(probeId, slot) {
  return md5(`${probeId}|${slot}`).slice(0, 8)
}

function uuidFrom(text) {
  const hex = md5(text)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function pairIdFor(labelA, labelB) {
  return uuidFrom(`speak-kit-pair|default|${labelA}|${labelB}`)
}

export function probeIdFor(pairId, side, ordinal) {
  return uuidFrom(`speak-kit-probe|${pairId}|${side}|${ordinal}`)
}

function definition(exerciseKey, trainingMode, targetCapability, prompt, references, rubric, difficulty) {
  return {
    exerciseKey,
    trainingMode,
    targetCapability,
    promptSpec: { prompt },
    referenceExamples: references,
    acceptedVariants: [],
    rubric,
    difficulty,
    modality: "text",
  }
}

export function deriveDefinitions(expression) {
  const definitions = []
  const code = expression.code
  if (code) {
    const { en, ja } = expression.example
    const recallDifficulty = expression.tier === "CORE" ? 2 : 1
    definitions.push(definition(`${code}-CR`, "controlled_recall", "CONTROLLED_RECALL", ja, [en],
      { rubric_version: "controlled-recall-v2", required_dimensions: SIX }, recallDifficulty))
    definitions.push(definition(`${code}-RG`, "recognition", "RECOGNITION", `次の英文の意味を日本語で答えてください: ${en}`, [ja],
      { rubric_version: "recognition-v1", required_dimensions: ["communication", "semantic", "intent", "policy"] }, recallDifficulty))
    if (expression.kind === "pattern") {
      definitions.push(definition(`${code}-SR`, "slot_replacement", "SLOT_REPLACEMENT", `指定された型を使い、次を英語にしてください: ${ja}`, [en],
        { rubric_version: "slot-replacement-v1", required_dimensions: SIX }, 2))
    }
    if (expression.contrast_drill) {
      definitions.push(definition(`${code}-CD`, "contrast_drill", "CONTRAST_SELECTION", `時制・意図の違いに注意して英語全文で答えてください: ${ja}`, [en],
        { rubric_version: "contrast-drill-v1", required_dimensions: SIX }, 3))
    }
    if (expression.tier === "CORE") {
      definitions.push(definition(`${code}-FP`, "free_production", "FREE_PRODUCTION", `この用途を使い、あなた自身について英語1文で答えてください: ${expression.meaning}`, [en],
        { rubric_version: "free-production-v1", required_dimensions: ["communication", "semantic", "intent", "policy", "target_skill_usage"] }, 3))
    }
    for (const probe of RETENTION) {
      definitions.push(definition(`${code}-RT-${probe.label}`, "spaced_retrieval", probe.capability, ja, [en],
        { rubric_version: `retention-${probe.label.toLowerCase()}-v1`, required_dimensions: SIX, retention_days: probe.days }, probe.difficulty))
    }
  }
  for (const extra of expression.extra_examples || []) {
    definitions.push(definition(extra.key, "controlled_recall", "CONTROLLED_RECALL", extra.ja, [extra.en],
      { rubric_version: extra.rubric || "controlled-recall-v2", required_dimensions: SIX }, extra.difficulty ?? 2))
  }
  return definitions
}

function options(idFor, entries) {
  return entries.map(([slot, text, kind]) => ({ id: idFor(slot), text, kind }))
}

export function deriveSkillQuizzes(expression) {
  const quizzes = []
  const quiz = expression.quiz || {}
  const key = expression.key
  const near = (list) => list.map((text, index) => [`near${index + 1}`, text, "near"])
  if (quiz.meaning) {
    quizzes.push({
      itemKey: `QZ-ME-${key}`,
      quizType: "meaning",
      capability: "RECOGNITION",
      prompt: expression.example.en,
      options: options((slot) => skillOptionId("meaning", key, slot), [["correct", quiz.meaning.correct ?? expression.example.ja, "correct"], ...near(quiz.meaning.near)]),
    })
  }
  if (quiz.intent) {
    quizzes.push({
      itemKey: `QZ-IN-${key}`,
      quizType: "intent",
      capability: "CONTRAST_SELECTION",
      prompt: `「${expression.meaning}」とき、使う形はどれ？`,
      options: options((slot) => skillOptionId("intent", key, slot), [["correct", quiz.intent.correct, "correct"], ...near(quiz.intent.near)]),
    })
  }
  if (quiz.form) {
    quizzes.push({
      itemKey: `QZ-FO-${key}`,
      quizType: "form",
      capability: "CONTRAST_SELECTION",
      prompt: quiz.form.prompt ?? expression.example.ja,
      options: options((slot) => skillOptionId("form", key, slot), [["correct", expression.example.en, "correct"], ...near(quiz.form.near)]),
    })
  }
  for (const item of quizzes) item.correctOptionId = item.options[0].id
  return quizzes
}

export function derivePair(pair) {
  const pairId = pair.id || pairIdFor(pair.a.label, pair.b.label)
  const ordinals = { a: 0, b: 0 }
  const probes = []
  const quizzes = []
  for (const probe of pair.probes || []) {
    ordinals[probe.side] += 1
    const ordinal = ordinals[probe.side]
    const probeId = probe.id || probeIdFor(pairId, probe.side, ordinal)
    probes.push({ probeId, side: probe.side, ordinal, prompt: probe.prompt, expectedText: probe.answer })
    if (probe.quiz) {
      const entries = [
        ["correct", probe.answer, "correct"],
        ["pair", probe.quiz.pair, "pair"],
        ...probe.quiz.near.map((text, index) => [`near${index + 1}`, text, "near"]),
      ]
      quizzes.push({
        itemKey: probe.quiz.key,
        quizType: "contrast",
        capability: "CONTRAST_SELECTION",
        prompt: probe.prompt,
        probeId,
        pairId,
        options: options((slot) => probeOptionId(probeId, slot), entries),
        correctOptionId: probeOptionId(probeId, "correct"),
      })
    }
  }
  return {
    pair: {
      pairId,
      labelA: pair.a.label,
      labelB: pair.b.label,
      skillKeyA: pair.a.skill_key ?? null,
      skillKeyB: pair.b.skill_key ?? null,
      keyA: pair.a.key ?? null,
      directionA: pair.a.direction ?? null,
      keyB: pair.b.key ?? null,
      directionB: pair.b.direction ?? null,
      confusionType: pair.type,
      source: pair.source || "catalog",
    },
    probes,
    quizzes,
  }
}
