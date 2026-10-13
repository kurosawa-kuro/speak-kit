import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stringify } from "yaml"
import { CATEGORY_FILES } from "./derive.mjs"
import { latestByKey, loadState } from "./state.mjs"

const STANDARD = /^(P1-\d{3})-(CR|RG|SR|CD|FP|RT-1D|RT-7D|RT-30D)$/

const HEADER = {
  expressions: "# 表現の教材。書き方は data/README.md。key と code は一度決めたら変えない。\n",
  pairs: "# 混同ペアの教材。書き方は data/README.md。id は一度決めたら変えない。学習の状態（取り違えた回数など）は DB にあり、ここには書かない。\n",
}

function nearTexts(item) {
  return item.options.filter((option) => option.kind === "near").map((option) => option.text)
}

function correctText(item) {
  return item.options.find((option) => option.kind === "correct")?.text
}

export function buildDocuments(state) {
  const definitions = latestByKey(state.definitions, "exercise_key", "version")
  const quizzes = latestByKey(state.quizzes, "item_key", "option_set_version")
  const bySkill = new Map()
  for (const row of definitions.values()) {
    const list = bySkill.get(Number(row.target_skill_id)) || []
    list.push(row)
    bySkill.set(Number(row.target_skill_id), list)
  }
  const files = Object.fromEntries(Object.values(CATEGORY_FILES).map((name) => [name, []]))
  for (const skill of state.skills) {
    const own = (bySkill.get(Number(skill.id)) || []).sort((a, b) => a.exercise_key.localeCompare(b.exercise_key))
    const recall = own.find((row) => STANDARD.test(row.exercise_key) && row.exercise_key.endsWith("-CR"))
    const code = recall ? recall.exercise_key.match(STANDARD)[1] : null
    const entry = { key: skill.stable_key }
    if (code) entry.code = code
    entry.form = skill.canonical_form
    entry.meaning = skill.meaning
    if (skill.intent) entry.intent = skill.intent
    entry.tier = skill.tier
    entry.kind = skill.concept_kind
    if (code) {
      entry.example = { en: recall.reference_examples[0], ja: recall.prompt_spec.prompt }
      if (own.some((row) => row.exercise_key === `${code}-CD`)) entry.contrast_drill = true
    }
    const extras = own.filter((row) => !(code && row.exercise_key.startsWith(`${code}-`) && STANDARD.test(row.exercise_key)))
    if (extras.length) {
      entry.extra_examples = extras.map((row) => {
        const extra = { key: row.exercise_key, en: row.reference_examples[0], ja: row.prompt_spec.prompt }
        if (row.difficulty !== 2) extra.difficulty = row.difficulty
        if (row.rubric.rubric_version !== "controlled-recall-v2") extra.rubric = row.rubric.rubric_version
        return extra
      })
    }
    const quiz = {}
    const meaning = quizzes.get(`QZ-ME-${skill.stable_key}`)
    const intent = quizzes.get(`QZ-IN-${skill.stable_key}`)
    const form = quizzes.get(`QZ-FO-${skill.stable_key}`)
    const exampleJa = entry.example?.ja
    if (meaning) {
      quiz.meaning = {}
      if (correctText(meaning) !== exampleJa) quiz.meaning.correct = correctText(meaning)
      quiz.meaning.near = nearTexts(meaning)
    }
    if (intent) quiz.intent = { correct: correctText(intent), near: nearTexts(intent) }
    if (form) {
      quiz.form = {}
      if (form.prompt !== exampleJa) quiz.form.prompt = form.prompt
      quiz.form.near = nearTexts(form)
    }
    if (Object.keys(quiz).length) entry.quiz = quiz
    entry.status = skill.status
    files[CATEGORY_FILES[skill.category]].push(entry)
  }

  const contrastByProbe = new Map()
  for (const item of quizzes.values()) {
    if (item.quiz_type === "contrast" && item.probe_id) contrastByProbe.set(item.probe_id, item)
  }
  const pairs = state.pairs.map((pair) => {
    const side = (label, skillKey, key, direction) => {
      const value = { label }
      if (skillKey) value.skill_key = skillKey
      if (key) value.key = key
      if (direction) value.direction = direction
      return value
    }
    const entry = {
      id: pair.pair_id,
      type: pair.confusion_type,
      a: side(pair.label_a, pair.skill_key_a, pair.key_a, pair.direction_a),
      b: side(pair.label_b, pair.skill_key_b, pair.key_b, pair.direction_b),
    }
    if (pair.source !== "catalog") entry.source = pair.source
    const probes = state.probes.filter((probe) => probe.pair_id === pair.pair_id)
    if (probes.length) {
      entry.probes = probes.map((probe) => {
        const value = { id: probe.probe_id, side: probe.side, prompt: probe.prompt, answer: probe.expected_text }
        const item = contrastByProbe.get(probe.probe_id)
        if (item) {
          value.quiz = {
            key: item.item_key,
            pair: item.options.find((option) => option.kind === "pair")?.text,
            near: nearTexts(item),
          }
        }
        return value
      })
    }
    return entry
  })
  return { expressions: files, pairs }
}

export async function exportContent(db, dataDir) {
  const documents = buildDocuments(await loadState(db))
  mkdirSync(join(dataDir, "expressions"), { recursive: true })
  const written = []
  for (const [name, entries] of Object.entries(documents.expressions)) {
    const path = join(dataDir, "expressions", `${name}.yaml`)
    writeFileSync(path, HEADER.expressions + stringify(entries, { lineWidth: 0 }))
    written.push({ path, count: entries.length })
  }
  const pairsPath = join(dataDir, "confusion_pairs.yaml")
  writeFileSync(pairsPath, HEADER.pairs + stringify(documents.pairs, { lineWidth: 0 }))
  written.push({ path: pairsPath, count: documents.pairs.length })
  return written
}
