import { query } from "./db.mjs"

const LEARNER = "default"
const DEFAULTS = { aiEnabled: true }

export async function getSettings() {
  const result = await query(
    "SELECT ai_enabled, updated_at FROM skill_trainer.learner_settings WHERE learner_key = $1",
    [LEARNER],
  )
  const row = result.rows[0]
  if (!row) return { ...DEFAULTS, updatedAt: null }
  return { aiEnabled: row.ai_enabled, updatedAt: row.updated_at }
}

/** 起動時に決まり、画面からは変えない設定。接続文字列とパスワードは返さない。 */
export function startupSettings() {
  const url = new URL(process.env.SPEAK_KIT_DATABASE_URL || "postgresql://kurosawa@localhost:5432/speak_kit")
  return {
    login: "disabled",
    database: { kind: "local", name: url.pathname.replace(/^\//, ""), host: url.hostname },
  }
}

export async function saveSettings({ aiEnabled }) {
  const result = await query(
    `INSERT INTO skill_trainer.learner_settings (learner_key, ai_enabled, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (learner_key) DO UPDATE SET ai_enabled = EXCLUDED.ai_enabled, updated_at = now()
     RETURNING ai_enabled, updated_at`,
    [LEARNER, aiEnabled],
  )
  return { aiEnabled: result.rows[0].ai_enabled, updatedAt: result.rows[0].updated_at }
}
