import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { LineCounter, isSeq, parseDocument } from "yaml"
import { CATEGORY_FILES, EXTRA_RUBRICS, KINDS, PAIR_TYPES, STATUSES, TIERS, deriveDefinitions } from "./derive.mjs"

const EXPRESSION_FIELDS = ["key", "code", "form", "meaning", "intent", "tier", "kind", "contrast_drill", "example", "extra_examples", "quiz", "status"]
const PAIR_FIELDS = ["id", "type", "a", "b", "source", "probes"]
const SIDE_FIELDS = ["label", "skill_key", "key", "direction"]
const PROBE_FIELDS = ["id", "side", "prompt", "answer", "quiz"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CATEGORY_BY_FILE = Object.fromEntries(Object.entries(CATEGORY_FILES).map(([category, file]) => [`${file}.yaml`, category]))

function readList(path, root, errors) {
  const lineCounter = new LineCounter()
  const source = readFileSync(path, "utf8")
  const document = parseDocument(source, { lineCounter })
  const file = relative(root, path)
  for (const error of document.errors) {
    errors.push(`${file}:${error.linePos?.[0]?.line ?? 1} YAML として読めません: ${error.message.split("\n")[0]}`)
  }
  if (document.errors.length) return []
  const contents = document.contents
  if (contents == null) return []
  if (!isSeq(contents)) {
    errors.push(`${file}:1 ファイル全体を「- 」で始まる一覧にしてください`)
    return []
  }
  return contents.items.map((node) => ({
    value: node.toJSON(),
    file,
    line: lineCounter.linePos(node.range?.[0] ?? 0).line,
  }))
}

const isText = (value) => typeof value === "string" && value.trim().length > 0
/** DB の skill_trainer.has_unresolved_placeholder と同じ判定。練習問題の文と答えに使う。 */
export function hasPlaceholder(value) {
  if (typeof value !== "string" || value.trim() === "") return true
  if (/(\.\.\.|…|〜|～|\{|\})/.test(value)) return true
  if (/^(A|B)$/.test(value.trim())) return true
  return /(^|[^A-Za-z])A([^A-Za-z]|$)/.test(value) && /(^|[^A-Za-z])B([^A-Za-z]|$)/.test(value)
}

function unknownFields(value, allowed) {
  return Object.keys(value || {}).filter((name) => !allowed.includes(name))
}

export function loadContent(dataDir) {
  const root = join(dataDir, "..")
  const errors = []
  const expressions = []
  const pairs = []
  const expressionDir = join(dataDir, "expressions")
  if (!existsSync(expressionDir)) {
    errors.push(`${relative(root, expressionDir)} がありません。npm run data:export で作れます`)
    return { expressions, pairs, errors }
  }
  for (const name of readdirSync(expressionDir).filter((entry) => entry.endsWith(".yaml")).sort()) {
    const category = CATEGORY_BY_FILE[name]
    if (!category) {
      errors.push(`${relative(root, join(expressionDir, name))}:1 ファイル名はカテゴリの名前（${Object.keys(CATEGORY_BY_FILE).join("、")}）にしてください`)
      continue
    }
    for (const item of readList(join(expressionDir, name), root, errors)) {
      expressions.push({ ...item, value: item.value ?? {}, category })
    }
  }
  const pairsPath = join(dataDir, "confusion_pairs.yaml")
  if (existsSync(pairsPath)) pairs.push(...readList(pairsPath, root, errors))
  validate(expressions, pairs, errors)
  return {
    expressions: expressions.map((item) => ({ ...item.value, category: item.category, _at: `${item.file}:${item.line}` })),
    pairs: pairs.map((item) => ({ ...item.value, _at: `${item.file}:${item.line}` })),
    errors,
  }
}

function validate(expressions, pairs, errors) {
  const keys = new Map()
  const codes = new Map()
  const exerciseKeys = new Map()
  const quizKeys = new Map()
  for (const { value, file, line } of expressions) {
    const at = `${file}:${line}`
    const fail = (message) => errors.push(`${at} ${message}`)
    if (typeof value !== "object" || Array.isArray(value)) {
      fail("表現は「key: …」の形で書いてください")
      continue
    }
    for (const name of unknownFields(value, EXPRESSION_FIELDS)) fail(`知らない項目「${name}」があります（綴りを確かめてください）`)
    if (!isText(value.key) || !/^[A-Z][A-Z0-9_]*$/.test(value.key)) fail("key は大文字・数字・_ で書いてください（例: REQUEST_COULD_YOU）")
    else if (keys.has(value.key)) fail(`key「${value.key}」が重複しています（${keys.get(value.key)} にもあります）`)
    else keys.set(value.key, at)
    if (value.code !== undefined) {
      if (!isText(value.code) || !/^P1-\d{3}$/.test(value.code)) fail("code は P1- と 3 桁の数字で書いてください（例: P1-051）")
      else if (codes.has(value.code)) fail(`code「${value.code}」が重複しています（${codes.get(value.code)} にもあります）`)
      else codes.set(value.code, at)
    }
    if (!isText(value.form)) fail("form（形）がありません")
    if (!isText(value.meaning)) fail("meaning（意味）がありません")
    if (value.intent !== undefined && !isText(value.intent)) fail("intent は文字で書いてください")
    if (!TIERS.includes(value.tier)) fail(`tier は ${TIERS.join(" か ")} にしてください`)
    if (!KINDS.includes(value.kind)) fail(`kind は ${KINDS.join(" か ")} にしてください`)
    if (!STATUSES.includes(value.status)) fail(`status は ${STATUSES.join(" か ")} にしてください`)
    if (value.contrast_drill !== undefined && typeof value.contrast_drill !== "boolean") fail("contrast_drill は true か false にしてください")
    const example = value.example
    if (value.code !== undefined || value.quiz?.meaning || value.quiz?.form) {
      if (!example || !isText(example.en) || !isText(example.ja)) fail("example の en（英語）と ja（日本語）を書いてください")
      else {
        if (unknownFields(example, ["en", "ja"]).length) fail("example に書けるのは en と ja だけです")
        if (hasPlaceholder(example.en) || hasPlaceholder(example.ja)) fail("例文に 〜 や ... や {} が残っています。実際の文を書いてください")
      }
    } else if (example !== undefined) fail("example を使うときは code も書いてください")
    if (value.extra_examples !== undefined) {
      if (!Array.isArray(value.extra_examples)) fail("extra_examples は一覧（- ）で書いてください")
      else {
        value.extra_examples.forEach((extra, index) => {
          const where = `extra_examples の ${index + 1} 件目`
          if (unknownFields(extra, ["key", "en", "ja", "difficulty", "rubric"]).length) fail(`${where} に知らない項目があります`)
          if (!isText(extra?.key) || !/^[A-Z][A-Z0-9-]*$/.test(extra.key)) fail(`${where} の key は大文字・数字・- で書いてください（例: REQ-004）`)
          if (!isText(extra?.en) || !isText(extra?.ja)) fail(`${where} の en と ja を書いてください`)
          else if (hasPlaceholder(extra.en) || hasPlaceholder(extra.ja)) fail(`${where} に 〜 や ... や {} が残っています`)
          if (extra?.difficulty !== undefined && !(Number.isInteger(extra.difficulty) && extra.difficulty >= 1 && extra.difficulty <= 5)) fail(`${where} の difficulty は 1〜5 にしてください`)
          if (extra?.rubric !== undefined && !EXTRA_RUBRICS.includes(extra.rubric)) fail(`${where} の rubric は ${EXTRA_RUBRICS.join(" か ")} にしてください`)
        })
      }
    }
    const quiz = value.quiz
    if (quiz !== undefined) {
      if (typeof quiz !== "object" || Array.isArray(quiz)) fail("quiz は meaning / intent / form の形で書いてください")
      else {
        for (const name of unknownFields(quiz, ["meaning", "intent", "form"])) fail(`quiz に知らない種類「${name}」があります`)
        const checkNear = (type, correct, near) => {
          if (!Array.isArray(near) || near.length !== 3 || !near.every(isText)) fail(`quiz.${type} の near（誤答）はちょうど 3 つ書いてください`)
          else if (new Set(near).size !== 3) fail(`quiz.${type} の誤答が重複しています`)
          else if (correct && near.includes(correct)) fail(`quiz.${type} の誤答に正解「${correct}」が入っています`)
        }
        const allowed = { meaning: ["correct", "near"], intent: ["correct", "near"], form: ["prompt", "near"] }
        for (const [type, fields] of Object.entries(allowed)) {
          if (quiz[type] === undefined) continue
          for (const name of unknownFields(quiz[type], fields)) fail(`quiz.${type} に知らない項目「${name}」があります（書けるのは ${fields.join(" と ")}）`)
        }
        if (quiz.meaning?.correct !== undefined && !isText(quiz.meaning.correct)) fail("quiz.meaning の correct は文字で書いてください")
        if (quiz.form?.prompt !== undefined && !isText(quiz.form.prompt)) fail("quiz.form の prompt は文字で書いてください")
        if (quiz.meaning) checkNear("meaning", quiz.meaning.correct ?? example?.ja, quiz.meaning.near)
        if (quiz.form) checkNear("form", example?.en, quiz.form.near)
        if (quiz.intent) {
          if (!isText(quiz.intent.correct)) fail("quiz.intent の correct（正解の形）を書いてください")
          checkNear("intent", quiz.intent.correct, quiz.intent.near)
        }
      }
    }
    if (isText(value.key)) {
      for (const type of ["ME", "IN", "FO"]) quizKeys.set(`QZ-${type}-${value.key}`, at)
    }
    if (TIERS.includes(value.tier) && KINDS.includes(value.kind)) {
      try {
        for (const definition of deriveDefinitions(value)) {
          if (exerciseKeys.has(definition.exerciseKey)) fail(`練習問題の key「${definition.exerciseKey}」が重複しています（${exerciseKeys.get(definition.exerciseKey)} にもあります）`)
          else exerciseKeys.set(definition.exerciseKey, at)
          for (const text of [definition.promptSpec.prompt, ...definition.referenceExamples]) {
            if (hasPlaceholder(text)) fail(`練習問題 ${definition.exerciseKey} の文「${text}」に 〜 や ... や {}、または A と B の穴埋めが残っています（tier が CORE だと meaning もこの文に入ります）`)
          }
        }
      } catch {
        // 上の検査で間違いを出している
      }
    }
  }

  const pairIds = new Map()
  const labelPairs = new Map()
  for (const { value, file, line } of pairs) {
    const at = `${file}:${line}`
    const fail = (message) => errors.push(`${at} ${message}`)
    if (typeof value !== "object" || Array.isArray(value)) {
      fail("混同ペアは「type: …」の形で書いてください")
      continue
    }
    for (const name of unknownFields(value, PAIR_FIELDS)) fail(`知らない項目「${name}」があります（綴りを確かめてください）`)
    if (value.id !== undefined && !(isText(value.id) && UUID.test(value.id))) fail("id の形が違います。新しいペアなら id は書かないでください（自動で決まります）")
    else if (value.id && pairIds.has(value.id)) fail(`id が重複しています（${pairIds.get(value.id)} にもあります）`)
    else if (value.id) pairIds.set(value.id, at)
    if (!PAIR_TYPES.includes(value.type)) fail(`type は ${PAIR_TYPES.join("、")} のどれかにしてください`)
    if (value.source !== undefined && !["catalog", "observed_mistake", "learner_registered"].includes(value.source)) fail("source の値が違います")
    for (const sideName of ["a", "b"]) {
      const side = value[sideName]
      if (!side || !isText(side.label)) {
        fail(`${sideName}.label を書いてください`)
        continue
      }
      for (const name of unknownFields(side, SIDE_FIELDS)) fail(`${sideName} に知らない項目「${name}」があります`)
      if (!isText(side.key)) fail(`${sideName}.key（その形の短い説明。例: その時した？）を書いてください`)
      if (!isText(side.direction)) fail(`${sideName}.direction（見分ける手がかり。例: 特定の過去）を書いてください`)
      if (side.skill_key !== undefined && !keys.has(side.skill_key)) fail(`${sideName}.skill_key「${side.skill_key}」という表現がありません`)
    }
    if (isText(value.a?.label) && isText(value.b?.label)) {
      if (!(value.a.label < value.b.label)) fail(`a.label と b.label は文字の順に並べてください（「${value.b.label}」を a に、「${value.a.label}」を b に）`)
      const labelKey = `${value.a.label}\u0000${value.b.label}`
      if (labelPairs.has(labelKey)) fail(`同じ組み合わせのペアがあります（${labelPairs.get(labelKey)}）`)
      else labelPairs.set(labelKey, at)
    }
    if (value.probes !== undefined) {
      if (!Array.isArray(value.probes)) fail("probes は一覧（- ）で書いてください")
      else value.probes.forEach((probe, index) => {
        const where = `probes の ${index + 1} 件目`
        for (const name of unknownFields(probe, PROBE_FIELDS)) fail(`${where} に知らない項目「${name}」があります`)
        if (probe?.id !== undefined && !(isText(probe.id) && UUID.test(probe.id))) fail(`${where} の id の形が違います。新しい確認問題なら id は書かないでください`)
        if (!["a", "b"].includes(probe?.side)) fail(`${where} の side は a か b にしてください（a.label の側なら a）`)
        if (!isText(probe?.prompt) || !isText(probe?.answer)) fail(`${where} の prompt と answer を書いてください`)
        if (probe?.quiz !== undefined) {
          const quiz = probe.quiz
          if (!isText(quiz?.key) || !/^QZ-CS-[A-Za-z0-9-]+$/.test(quiz.key)) fail(`${where} の quiz.key は QZ-CS- で始めてください（例: QZ-CS-0128）`)
          else if (quizKeys.has(quiz.key)) fail(`${where} の quiz.key「${quiz.key}」が重複しています（${quizKeys.get(quiz.key)} にもあります）`)
          else quizKeys.set(quiz.key, at)
          if (!isText(quiz?.pair)) fail(`${where} の quiz.pair（取り違えやすい側の文）を書いてください`)
          if (!Array.isArray(quiz?.near) || quiz.near.length !== 2 || !quiz.near.every(isText)) fail(`${where} の quiz.near（誤答）はちょうど 2 つ書いてください`)
          else {
            const all = [probe.answer, quiz.pair, ...quiz.near]
            if (new Set(all).size !== 4) fail(`${where} のクイズの選択肢（answer・pair・near）が重複しています`)
          }
        }
      })
    }
  }
}
