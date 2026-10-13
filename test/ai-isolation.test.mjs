import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { feedback, scenario, talk } from "../lib/ai/features.mjs"

const coreFiles = [
  "lib/quiz.mjs",
  "lib/plan.mjs",
  "lib/dispatch.mjs",
  "app/api/[name]/route.js",
]

test("core files do not import the AI client", () => {
  for (const file of coreFiles) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    assert.equal(source.includes("lib/ai/client"), false, file)
    assert.equal(source.includes("api.anthropic.com"), false, file)
  }
})

test("unset key returns before any model call", async () => {
  delete process.env.ANTHROPIC_API_KEY
  const talkResult = await talk({ scenario: "teacher", message: "Hello" })
  const feedbackResult = await feedback({ text: "I am tired." })
  const scene = await scenario()
  for (const result of [talkResult, feedbackResult, scene]) {
    assert.equal(result.ok, false)
    assert.equal(result.code, "ai_unavailable")
  }
})
