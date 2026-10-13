import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { LOCAL_RPC_NAMES, REFERENCE_RPC_NAMES, RPC_NAMES } from "../server/rpc-names.mjs"

test("rpc names match the reference dispatch", () => {
  const source = readFileSync(
    "/Users/kurosawa/Dev/private-ops/apps/skill-trainer/src/skill_trainer_local.rs",
    "utf8",
  )
  const start = source.indexOf("pub async fn dispatch")
  const block = source.slice(start, start + source.slice(start + 20).indexOf("\n}\n") + 20)
  const names = [...block.matchAll(/"skill_trainer_[a-z0-9_]+"/g)].map((match) => match[0].slice(1, -1))
  assert.deepEqual(REFERENCE_RPC_NAMES, names)
  assert.equal(names.length, 16)
  assert.deepEqual(RPC_NAMES, [...names, ...LOCAL_RPC_NAMES])
  assert.ok(LOCAL_RPC_NAMES.every((name) => !names.includes(name)))
})
