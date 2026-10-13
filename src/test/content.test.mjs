import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { deriveDefinitions, derivePair, deriveSkillQuizzes, probeOptionId, skillOptionId } from "../server/content/derive.mjs"
import { hasPlaceholder, loadContent } from "../server/content/schema.mjs"

const coffee = {
  key: "TEST_GRAB_COFFEE",
  code: "P1-090",
  form: "grab a coffee with ~",
  meaning: "人と軽くコーヒーを飲む",
  tier: "CORE",
  kind: "pattern",
  contrast_drill: true,
  example: { en: "Let's grab a coffee with Ken.", ja: "ケンと軽くコーヒーを飲もう。" },
  quiz: {
    meaning: { near: ["ケンにコーヒーを買おう。", "ケンとコーヒーを作ろう。", "ケンはコーヒーを飲んだ。"] },
    form: { near: ["Let's grab coffee to Ken.", "Let's take a coffee for Ken.", "Let's grabbing a coffee with Ken."] },
  },
  status: "active",
}

test("an expression with every option gets the eight practice modes", () => {
  const keys = deriveDefinitions(coffee).map((definition) => definition.exerciseKey)
  assert.deepEqual(keys, ["P1-090-CR", "P1-090-RG", "P1-090-SR", "P1-090-CD", "P1-090-FP", "P1-090-RT-1D", "P1-090-RT-7D", "P1-090-RT-30D"])
})

test("modes follow tier, kind and contrast_drill like the catalog migration", () => {
  const chunk = { ...coffee, tier: "TIER1", kind: "atomic_chunk", contrast_drill: undefined }
  const definitions = deriveDefinitions(chunk)
  assert.deepEqual(definitions.map((definition) => definition.exerciseKey.slice(7)), ["CR", "RG", "RT-1D", "RT-7D", "RT-30D"])
  assert.equal(definitions[0].difficulty, 1)
  assert.equal(deriveDefinitions(coffee)[0].difficulty, 2)
  assert.equal(definitions[1].promptSpec.prompt, "次の英文の意味を日本語で答えてください: Let's grab a coffee with Ken.")
})

test("extra examples become controlled recall with their own rubric and difficulty", () => {
  const [extra] = deriveDefinitions({ ...coffee, code: undefined, extra_examples: [{ key: "REQ-001", en: "Could you send it?", ja: "送ってもらえますか？", difficulty: 1, rubric: "controlled-recall-v1" }] })
  assert.equal(extra.exerciseKey, "REQ-001")
  assert.equal(extra.difficulty, 1)
  assert.equal(extra.rubric.rubric_version, "controlled-recall-v1")
})

test("quiz option ids are the same position-based ids as the existing rows", () => {
  assert.equal(skillOptionId("meaning", "REQUEST_COULD_YOU", "correct"), "ec845ba2")
  assert.equal(skillOptionId("meaning", "REQUEST_COULD_YOU", "near1"), "09e07126")
  const probe = "11111111-1111-4111-8111-000000000001"
  assert.equal(probeOptionId(probe, "correct"), "53419d5e")
  assert.equal(probeOptionId(probe, "pair"), "e41c7c07")
  assert.equal(probeOptionId(probe, "near1"), "2ebb62cb")
})

test("skill quizzes use the example unless the YAML overrides the Japanese", () => {
  const [meaning, form] = deriveSkillQuizzes(coffee)
  assert.equal(meaning.itemKey, "QZ-ME-TEST_GRAB_COFFEE")
  assert.equal(meaning.options[0].text, coffee.example.ja)
  assert.equal(meaning.correctOptionId, meaning.options[0].id)
  assert.equal(form.prompt, coffee.example.ja)
  const overridden = deriveSkillQuizzes({ ...coffee, quiz: { meaning: { ...coffee.quiz.meaning, correct: "軽く飲む" }, form: { ...coffee.quiz.form, prompt: "軽く飲もう。" } } })
  assert.equal(overridden[0].options[0].text, "軽く飲む")
  assert.equal(overridden[1].prompt, "軽く飲もう。")
})

test("new pairs and probes get stable ids and per-side ordinals", () => {
  const entry = {
    type: "MEANING",
    a: { label: "grab a coffee", key: "軽く飲む", direction: "誘う" },
    b: { label: "make a coffee", key: "いれる", direction: "作る" },
    probes: [
      { side: "a", prompt: "p1", answer: "a1" },
      { side: "b", prompt: "p2", answer: "a2" },
      { side: "a", prompt: "p3", answer: "a3" },
    ],
  }
  const first = derivePair(entry)
  assert.deepEqual(first.probes.map((probe) => `${probe.side}${probe.ordinal}`), ["a1", "b1", "a2"])
  assert.equal(derivePair(entry).pair.pairId, first.pair.pairId)
  assert.equal(first.pair.source, "catalog")
})

test("placeholder check matches the database rule", () => {
  assert.equal(hasPlaceholder("〜と軽くコーヒーを飲む"), true)
  assert.equal(hasPlaceholder("Could you ...?"), true)
  assert.equal(hasPlaceholder("Choose A or B."), true)
  assert.equal(hasPlaceholder("I want a coffee."), false)
})

function writeData(expressions, pairs) {
  const dir = mkdtempSync(join(tmpdir(), "speak-kit-data-"))
  mkdirSync(join(dir, "expressions"))
  writeFileSync(join(dir, "expressions", "action.yaml"), expressions)
  writeFileSync(join(dir, "confusion_pairs.yaml"), pairs)
  return dir
}

test("check reports file and line for broken YAML", () => {
  const dir = writeData(
    [
      "- key: GRAB",
      "  form: grab",
      "  meaning: 取る",
      "  tier: TIER1",
      "  kind: atomic_chunk",
      "  status: active",
      "- key: GRAB",
      "  form: grab it",
      "  meaning: それを取る",
      "  tier: TIER1",
      "  kind: atomic_chunk",
      "  example: { en: grab it, ja: それを取る }",
      "  quiz:",
      "    meaning:",
      "      near: [a, b]",
      "  status: active",
      "",
    ].join("\n"),
    [
      "- type: MEANING",
      "  a: { label: a thing, skill_key: NOPE, key: k, direction: d }",
      "  b: { label: b thing, key: k, direction: d }",
      "",
    ].join("\n"),
  )
  const { errors } = loadContent(dir)
  assert.ok(errors.some((error) => /action\.yaml:7 key「GRAB」が重複/.test(error)), errors.join("\n"))
  assert.ok(errors.some((error) => /action\.yaml:7 quiz\.meaning の near（誤答）はちょうど 3 つ/.test(error)), errors.join("\n"))
  assert.ok(errors.some((error) => /confusion_pairs\.yaml:1 a\.skill_key「NOPE」という表現がありません/.test(error)), errors.join("\n"))
})

test("check accepts a well-formed expression and pair", () => {
  const dir = writeData(
    [
      "- key: GRAB",
      "  form: grab",
      "  meaning: 取る",
      "  tier: TIER1",
      "  kind: atomic_chunk",
      "  status: active",
      "",
    ].join("\n"),
    [
      "- type: MEANING",
      "  a: { label: a thing, skill_key: GRAB, key: k, direction: d }",
      "  b: { label: b thing, key: k, direction: d }",
      "  probes:",
      "    - side: a",
      "      prompt: 取って",
      "      answer: grab it",
      "",
    ].join("\n"),
  )
  const content = loadContent(dir)
  assert.deepEqual(content.errors, [])
  assert.equal(content.expressions[0].category, "ACTION")
})
