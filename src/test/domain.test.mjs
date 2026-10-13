import assert from "node:assert/strict"
import test from "node:test"
import { boundaryCrossed, folded } from "../server/domain/boundary.mjs"
import { learnerPhrase, normalizeAnswer } from "../server/domain/normalize.mjs"
import { costUsd, overLimit } from "../server/ai/usage.mjs"

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
