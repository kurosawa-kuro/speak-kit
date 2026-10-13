import assert from "node:assert/strict"
import test from "node:test"
import { checkPassword } from "../server/http/guard.mjs"

const basic = (user, password) => `Basic ${btoa(`${user}:${password}`)}`

test("合言葉が未設定なら、ローカルでは開き、Vercel では誰にも開かない", () => {
  assert.equal(checkPassword(null, { password: undefined, onVercel: false }), "allow")
  assert.equal(checkPassword(null, { password: "", onVercel: true }), "misconfigured")
})

test("合言葉が合うときだけ開く。ユーザー名は見ない", () => {
  const options = { password: "s3cret", onVercel: true }
  assert.equal(checkPassword(basic("any", "s3cret"), options), "allow")
  assert.equal(checkPassword(basic("", "s3cret"), options), "allow")
  assert.equal(checkPassword(basic("any", "wrong"), options), "challenge")
  assert.equal(checkPassword(basic("any", "s3cret!"), options), "challenge")
  assert.equal(checkPassword(null, options), "challenge")
  assert.equal(checkPassword("Bearer x", options), "challenge")
  assert.equal(checkPassword("Basic !!!", options), "challenge")
})
