import test from "node:test"
import assert from "node:assert/strict"
import { isImeEnter, isSubmitEnter } from "../app/ui/keys.js"

test("変換中の Enter は送信しない（Chrome: isComposing）", () => {
  const event = { key: "Enter", keyCode: 13, nativeEvent: { isComposing: true } }
  assert.equal(isImeEnter(event), true)
  assert.equal(isSubmitEnter(event), false)
})

test("変換確定の Enter は送信しない（Safari: keyCode 229）", () => {
  const event = { key: "Enter", keyCode: 229, nativeEvent: { isComposing: false } }
  assert.equal(isImeEnter(event), true)
  assert.equal(isSubmitEnter(event), false)
})

test("ふつうの Enter は送信する", () => {
  const event = { key: "Enter", keyCode: 13, nativeEvent: { isComposing: false } }
  assert.equal(isSubmitEnter(event), true)
})

test("Enter 以外は送信しない", () => {
  const event = { key: "a", keyCode: 65, nativeEvent: { isComposing: false } }
  assert.equal(isSubmitEnter(event), false)
  assert.equal(isImeEnter(event), false)
})
