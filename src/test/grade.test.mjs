import assert from "node:assert/strict"
import test from "node:test"
import { gradeDecision, learnerFeedback, normalizeAnswer, reduceObservation } from "../server/ai/grade.mjs"

const bus = {
  trainingMode: "controlled_recall",
  prompt: "バスに乗る",
  expectedReference: "take a bus",
  canonicalForm: "take a bus",
  meaning: "バスに乗る",
  requiredDimensions: ["communication", "semantic", "intent", "form", "policy", "target_skill_usage"],
  acceptedVariants: [],
}
const noAi = { aiAvailable: false, aiReason: "key_missing" }

test("exact answer uses the original pass explanation", async () => {
  const result = await gradeDecision({ ...bus, answer: "Take a bus." }, noAi)
  assert.equal(result.status, "graded")
  assert.equal(result.success, true)
  assert.equal(result.source, "deterministic")
  assert.equal(result.reason, "意味も、今回の言い方「take a bus」（バスに乗る）も合っています。")
  assert.equal(normalizeAnswer("I'm tired."), "i am tired")
})

test("a mismatch without AI stays ungraded", async () => {
  const result = await gradeDecision({ ...bus, answer: "I ride the bus" }, noAi)
  assert.equal(result.status, "ungraded")
  assert.equal(result.success, null)
  assert.match(result.reason, /key_missing/)
})

test("reducer keeps the original outcome order", () => {
  const required = ["target_skill_usage"]
  assert.deepEqual(
    reduceObservation({ meaning_match: "yes", speech_act_match: "yes", comprehensibility: "clear", target_pattern_status: "not_used", issues: [] }, required),
    { outcome: "retry_target", cause: "FORM_SELECTION" },
  )
  assert.equal(
    learnerFeedback("retry_target", "FORM_SELECTION", "take a bus", "バスに乗る", "I ride the bus"),
    "意味は伝わっています。今回は「take a bus」（バスに乗る）を使う練習です。「I ride the bus」ではなく、まずこの形を使ってみましょう。",
  )
  assert.equal(
    reduceObservation({ meaning_match: "yes", speech_act_match: "yes", comprehensibility: "clear", target_pattern_status: "used", issues: [{ type: "TYPO" }] }, required).outcome,
    "pass_with_note",
  )
})
