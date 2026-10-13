import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { askClaude } from "../server/ai/client.mjs"

const coreFiles = [
  "server/services/quiz.mjs",
  "server/services/plan.mjs",
  "server/dispatch.mjs",
  "app/api/[name]/route.js",
]

test("core files do not import the AI client", () => {
  for (const file of coreFiles) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    assert.equal(source.includes("ai/client"), false, file)
    assert.equal(source.includes("api.anthropic.com"), false, file)
  }
})

test("an unavailable context returns before any model call", async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error("must not be called")
  }
  try {
    for (const aiReason of ["setting_off", "key_missing", "limit_reached"]) {
      const result = await askClaude({ aiAvailable: false, aiReason }, "test", "system", "user")
      assert.equal(result.ok, false)
      assert.equal(result.code, "ai_unavailable")
      assert.deepEqual(result.data, { aiAvailable: false, aiReason })
    }
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
