import { pool } from "./test-db.mjs"
import assert from "node:assert/strict"
import test from "node:test"
import { dispatch } from "../lib/dispatch.mjs"
import { aiStatus } from "../lib/ai/isEnabled.mjs"
import { feedback, scenario, talk } from "../lib/ai/features.mjs"
import { getSettings, saveSettings } from "../lib/settings.mjs"

const originalFetch = globalThis.fetch
const originalKey = process.env.ANTHROPIC_API_KEY
let original = null
let anthropicCalls = 0

test.before(async () => {
  original = (await getSettings()).aiEnabled
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("anthropic.com")) {
      anthropicCalls += 1
      return new Response(JSON.stringify({ error: { message: "stubbed" } }), { status: 500 })
    }
    return originalFetch(url, init)
  }
})

test.after(async () => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalKey
  if (original !== null) await saveSettings({ aiEnabled: original })
  await pool.end()
})

async function exerciseAiPaths() {
  const practice = await dispatch("skill_trainer_get_practice_v2", { practice_id: crypto.randomUUID(), training_mode: "free_production" })
  assert.equal(practice.ok, true, JSON.stringify(practice))
  const exercise = practice.data.exercise
  if (!exercise.confusionProbeId) {
    const graded = await dispatch("skill_trainer_submit_attempt_v2", {
      attempt_id: crypto.randomUUID(),
      exercise_instance_id: exercise.exerciseInstanceId,
      answer_text: "zzz not the answer",
      latency_ms: 1500,
      session_id: crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
    })
    assert.equal(graded.ok, true, JSON.stringify(graded))
  }
  const started = await dispatch("skill_trainer_start_talk_session_v2", { scenario: "teacher", session_id: crypto.randomUUID() })
  assert.equal(started.ok, true, JSON.stringify(started))
  const sent = await dispatch("skill_trainer_send_talk_message_v2", {
    conversation_session_id: started.data.conversationSessionId,
    turn_id: crypto.randomUUID(),
    message: "Hello, nice to meet you.",
    latency_ms: 2000,
  })
  assert.equal(sent.ok, true, JSON.stringify(sent))
  const ended = await dispatch("skill_trainer_end_talk_session_v2", { conversation_session_id: started.data.conversationSessionId })
  assert.equal(ended.ok, true, JSON.stringify(ended))
  const draft = await dispatch("skill_trainer_register_confusion_pair_v2", { label_a: "lend", label_b: "borrow" })
  assert.equal(draft.ok, false)
  await talk({ scenario: "teacher", message: "Hello" })
  await feedback({ text: "I am tired." })
  await scenario()
  return { practice, started, sent, draft }
}

test("setting off: no Anthropic request even with a key", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key"
  await saveSettings({ aiEnabled: false })
  const status = await aiStatus()
  assert.deepEqual(status, { aiEnabled: false, keyConfigured: true, setting: false, reason: "setting_off" })
  anthropicCalls = 0
  const { practice, started, sent, draft } = await exerciseAiPaths()
  assert.equal(anthropicCalls, 0)
  assert.equal(practice.data.aiAvailable, false)
  assert.equal(practice.data.aiReason, "setting_off")
  assert.equal(started.data.aiReason, "setting_off")
  assert.equal(sent.data.aiAvailable, false)
  assert.match(draft.error.message, /設定で AI をオフにしています/)
})

test("setting on without a key: AI stays unavailable", async () => {
  delete process.env.ANTHROPIC_API_KEY
  await saveSettings({ aiEnabled: true })
  assert.deepEqual(await aiStatus(), { aiEnabled: false, keyConfigured: false, setting: true, reason: "key_missing" })
  anthropicCalls = 0
  const { practice, draft } = await exerciseAiPaths()
  assert.equal(anthropicCalls, 0)
  assert.equal(practice.data.aiReason, "key_missing")
  assert.match(draft.error.message, /API キーが未設定です/)
})

test("setting on with a key: requests go to Anthropic again", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key"
  await saveSettings({ aiEnabled: true })
  assert.equal((await aiStatus()).aiEnabled, true)
  anthropicCalls = 0
  await feedback({ text: "I am tired." })
  assert.equal(anthropicCalls, 1)
})

test("choice path works with the setting off and with no key", async () => {
  for (const [key, setting] of [["sk-test-not-a-real-key", false], [undefined, true]]) {
    if (key) process.env.ANTHROPIC_API_KEY = key
    else delete process.env.ANTHROPIC_API_KEY
    await saveSettings({ aiEnabled: setting })
    anthropicCalls = 0
    const plan = await dispatch("skill_trainer_get_today_plan_v2", {})
    assert.equal(plan.ok, true)
    const quiz = await dispatch("skill_trainer_quiz_next_v1", {})
    const item = quiz.data.item
    const submitted = await dispatch("skill_trainer_submit_attempt_v2", {
      response_mode: "choice",
      submission_id: crypto.randomUUID(),
      item_key: item.itemKey,
      option_set_version: item.optionSetVersion,
      selected_option_id: item.options[0].id,
      option_order: item.options.map((option) => option.id),
      latency_ms: 12,
    })
    assert.equal(submitted.ok, true, JSON.stringify(submitted))
    const progress = await dispatch("skill_trainer_get_progress_v2", {})
    assert.equal(progress.ok, true)
    assert.equal(anthropicCalls, 0)
  }
})
