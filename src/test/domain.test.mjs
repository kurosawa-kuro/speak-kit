import assert from "node:assert/strict"
import test from "node:test"
import { boundaryCrossed, folded } from "../server/domain/boundary.mjs"
import { learnerPhrase, normalizeAnswer } from "../server/domain/normalize.mjs"
import { recognizedNotRecalled, verdict, verdictFields } from "../server/domain/verdict.mjs"
import { costUsd, overLimit } from "../server/ai/usage.mjs"
import { keyFromPattern } from "../server/services/candidates.mjs"
import { yen } from "../app/_lib/format.js"

test("normalizeAnswer folds case, punctuation and contractions", () => {
  assert.equal(normalizeAnswer("I'm tired."), "i am tired")
  assert.equal(normalizeAnswer("  Take   a BUS! "), "take a bus")
  assert.equal(typeof learnerPhrase("I'm tired."), "string")
})

test("boundaryCrossed finds the side the learner used instead", () => {
  assert.equal(folded("That’s why!"), "thats why")
  assert.deepEqual(
    boundaryCrossed("much", "How much water?", "How many water?"),
    { pairId: "11111111-1111-4111-8111-000000000190", missed: "b" },
  )
  assert.equal(boundaryCrossed("much", "How much water?", "How much water?"), null)
})

test("cost uses the configured price and a high fallback for unknown models", () => {
  assert.equal(costUsd("claude-sonnet-5", 1_000_000, 0), 2)
  assert.equal(costUsd("claude-sonnet-5", 0, 1_000_000), 10)
  assert.equal(costUsd("unknown-model", 1_000_000, 1_000_000), 90)
})

test("overLimit trips at the daily or monthly cap", () => {
  const base = { dayUsd: 0, monthUsd: 0, dailyLimitUsd: 2, monthlyLimitUsd: 20 }
  assert.equal(overLimit(base), false)
  assert.equal(overLimit({ ...base, dayUsd: 2 }), true)
  assert.equal(overLimit({ ...base, monthUsd: 20 }), true)
})

test("verdict decides the headline and the regrade button", () => {
  assert.equal(verdict("pending", null), "pending")
  assert.equal(verdict("graded", "success"), "success")
  assert.equal(verdict("graded", "failure"), "retry")
  assert.equal(verdict("ungraded", null), "ungraded")
  assert.equal(verdict("invalid", null), "ungraded")
  assert.deepEqual(verdictFields("ungraded", null), { verdict: "ungraded", canRegrade: true })
  assert.deepEqual(verdictFields("graded", "failure"), { verdict: "retry", canRegrade: false })
})

test("recognizedNotRecalled uses the 90% choice and 80% writing thresholds", () => {
  assert.equal(recognizedNotRecalled({ choiceSuccess: 9, choiceGraded: 10, textSuccess: 0, textGraded: 0 }), true)
  assert.equal(recognizedNotRecalled({ choiceSuccess: 9, choiceGraded: 10, textSuccess: 8, textGraded: 10 }), false)
  assert.equal(recognizedNotRecalled({ choiceSuccess: 8, choiceGraded: 10, textSuccess: 0, textGraded: 0 }), false)
  assert.equal(recognizedNotRecalled({ choiceSuccess: 0, choiceGraded: 0, textSuccess: 0, textGraded: 0 }), false)
})

test("keyFromPattern makes a YAML-valid key", () => {
  assert.equal(keyFromPattern("I was about to say that."), "I_WAS_ABOUT_TO_SAY_THAT")
  assert.equal(keyFromPattern("24/7 support"), "X_24_7_SUPPORT")
  assert.equal(keyFromPattern("…"), "CANDIDATE")
  assert.ok(keyFromPattern("one two three four five six seven eight nine ten eleven").length <= 40)
})

test("yen shows small amounts to one decimal and larger ones as whole yen", () => {
  assert.equal(yen(0.00407, 150), "¥0.6")
  assert.equal(yen(0, 150), "¥0.0")
  assert.equal(yen(2, 150), "¥300")
  assert.equal(yen(20, 150), "¥3,000")
})
