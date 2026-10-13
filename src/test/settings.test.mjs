import { pool } from "./test-db.mjs"
import assert from "node:assert/strict"
import test from "node:test"
import { dispatch } from "../server/dispatch.mjs"
import { operationContext } from "../server/ai/context.mjs"
import { getSettings, saveSettings } from "../server/services/settings.mjs"

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
  await pool.query("DELETE FROM skill_trainer.ai_usage WHERE feature = 'test'")
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
  assert.equal(draft.code, "ai_unavailable")
  return { practice, started, sent, draft }
}

async function status() {
  const context = await operationContext()
  return { aiAvailable: context.aiAvailable, keyConfigured: context.keyConfigured, aiReason: context.aiReason }
}

test("setting off: no Anthropic request even with a key", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key"
  await saveSettings({ aiEnabled: false })
  assert.deepEqual(await status(), { aiAvailable: false, keyConfigured: true, aiReason: "setting_off" })
  anthropicCalls = 0
  const { practice, started, sent, draft } = await exerciseAiPaths()
  assert.equal(anthropicCalls, 0)
  assert.equal(practice.data.aiAvailable, false)
  assert.equal(practice.data.aiReason, "setting_off")
  assert.equal(started.data.aiReason, "setting_off")
  assert.equal(sent.data.aiAvailable, false)
  assert.equal(draft.data.aiReason, "setting_off")
})

test("setting on without a key: AI stays unavailable", async () => {
  delete process.env.ANTHROPIC_API_KEY
  await saveSettings({ aiEnabled: true })
  assert.deepEqual(await status(), { aiAvailable: false, keyConfigured: false, aiReason: "key_missing" })
  anthropicCalls = 0
  const { practice, draft } = await exerciseAiPaths()
  assert.equal(anthropicCalls, 0)
  assert.equal(practice.data.aiReason, "key_missing")
  assert.equal(draft.data.aiReason, "key_missing")
})

test("setting on with a key: requests go to Anthropic again", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key"
  await saveSettings({ aiEnabled: true })
  assert.equal((await status()).aiAvailable, true)
  anthropicCalls = 0
  await dispatch("skill_trainer_register_confusion_pair_v2", { label_a: "rent", label_b: "hire" })
  assert.ok(anthropicCalls >= 1)
})

test("usage over the daily limit stops AI before any request", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key"
  await saveSettings({ aiEnabled: true })
  await pool.query(
    `INSERT INTO skill_trainer.ai_usage (feature, model, input_tokens, output_tokens, cost_usd)
     VALUES ('test', 'claude-sonnet-5', 500000, 100000, 2.0)`,
  )
  try {
    const context = await operationContext()
    assert.equal(context.aiReason, "limit_reached")
    assert.ok(context.usage.dayUsd >= 2)
    anthropicCalls = 0
    const { practice, draft } = await exerciseAiPaths()
    assert.equal(anthropicCalls, 0)
    assert.equal(practice.data.aiReason, "limit_reached")
    assert.equal(draft.data.aiReason, "limit_reached")
    const view = await dispatch("skill_trainer_get_settings_v1", {})
    assert.equal(view.data.ai.aiReason, "limit_reached")
    assert.equal(view.data.startup.ai.dailyLimitUsd, 2)
  } finally {
    await pool.query("DELETE FROM skill_trainer.ai_usage WHERE feature = 'test'")
  }
})

test("settings RPCs save the switch and reject a non-boolean", async () => {
  const bad = await dispatch("skill_trainer_save_settings_v1", { ai_enabled: "yes" })
  assert.equal(bad.code, "validation_error")
  const saved = await dispatch("skill_trainer_save_settings_v1", { ai_enabled: false })
  assert.equal(saved.data.settings.aiEnabled, false)
  assert.equal(saved.data.ai.aiReason, "setting_off")
  assert.equal(JSON.stringify(saved).includes("postgresql://"), false)
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
