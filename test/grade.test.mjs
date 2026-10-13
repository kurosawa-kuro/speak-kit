import assert from "node:assert/strict"
import test from "node:test"
import { gradeAttempt, learnerFeedback, normalizeAnswer, reduceObservation } from "../lib/ai/grade.mjs"

const bus = {
  trainingMode: "controlled_recall",
  prompt: "バスに乗る",
  expectedReference: "take a bus",
  canonicalForm: "take a bus",
  meaning: "バスに乗る",
  requiredDimensions: ["communication", "semantic", "intent", "form", "policy", "target_skill_usage"],
  acceptedVariants: [],
}

test("exact answer uses the original pass explanation", async () => {
  delete process.env.ANTHROPIC_API_KEY
  const result = await gradeAttempt({ ...bus, answer: "Take a bus." })
  assert.equal(result.ok, true)
  assert.equal(result.data.title, "成功")
  assert.equal(result.data.outcome, "success")
  assert.equal(result.data.detail, "意味も、今回の言い方「take a bus」（バスに乗る）も合っています。")
  assert.equal(normalizeAnswer("I'm tired."), "i am tired")
})

test("a mismatch without a key stays ungraded", async () => {
  delete process.env.ANTHROPIC_API_KEY
  const result = await gradeAttempt({ ...bus, answer: "I ride the bus" })
  assert.equal(result.data.title, "確認できませんでした")
  assert.equal(result.data.gradingStatus, "ungraded")
  assert.equal(result.data.detail, "正解を見て、もう一度この形を出してみましょう。")
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
