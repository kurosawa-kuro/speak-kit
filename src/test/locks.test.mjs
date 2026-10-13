import { pool } from "./test-db.mjs"
import assert from "node:assert/strict"
import test from "node:test"
import pg from "pg"
import { dispatch } from "../server/dispatch.mjs"
import { getSettings, saveSettings } from "../server/services/settings.mjs"

const originalFetch = globalThis.fetch
const originalKey = process.env.ANTHROPIC_API_KEY
let original = null
let release = null
let waiting = null

function stubSlowAnthropic() {
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("anthropic.com")) return originalFetch(url, init)
    await new Promise((resolve) => {
      release = resolve
      waiting?.()
    })
    return new Response(JSON.stringify({
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "Sounds good. What did you do next?" }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200 })
  }
}

function nextAiCall() {
  return new Promise((resolve) => {
    waiting = resolve
  })
}

test.before(async () => {
  original = (await getSettings()).aiEnabled
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key"
  await saveSettings({ aiEnabled: true })
  stubSlowAnthropic()
})

test.after(async () => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalKey
  if (original !== null) await saveSettings({ aiEnabled: original })
  await pool.query("DELETE FROM skill_trainer.ai_usage WHERE model = 'claude-sonnet-5' AND input_tokens = 10 AND output_tokens = 10")
  await pool.end()
})

test("AI を待つ間、会話の行のロックもトランザクションも持たない", async () => {
  const opening = nextAiCall()
  const startedPromise = dispatch("skill_trainer_start_talk_session_v2", { scenario: "teacher", session_id: crypto.randomUUID() })
  await opening
  release()
  const started = await startedPromise
  assert.equal(started.ok, true, JSON.stringify(started))
  const sessionId = started.data.conversationSessionId

  const turn = nextAiCall()
  const sent = dispatch("skill_trainer_send_talk_message_v2", {
    conversation_session_id: sessionId,
    turn_id: crypto.randomUUID(),
    message: "I went to the park yesterday.",
    latency_ms: 1500,
  })
  await turn

  const other = new pg.Client({ connectionString: process.env.SPEAK_KIT_DATABASE_URL })
  await other.connect()
  try {
    await other.query("BEGIN")
    await other.query("SET LOCAL lock_timeout = '500ms'")
    const locked = await other.query(
      "SELECT id FROM skill_trainer.conversation_sessions WHERE id = $1 FOR UPDATE NOWAIT",
      [sessionId],
    )
    assert.equal(locked.rowCount, 1)
    await other.query("ROLLBACK")
    const open = await other.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`,
    )
    assert.equal(open.rows[0].n, 0)
  } finally {
    await other.end()
  }

  while (release) {
    const next = release
    release = null
    const more = nextAiCall()
    next()
    const done = await Promise.race([sent.then(() => "done"), more.then(() => "more")])
    if (done === "done") break
  }
  const result = await sent
  assert.equal(result.ok, true, JSON.stringify(result))
})
