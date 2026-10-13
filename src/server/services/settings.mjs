import { config } from "../config.mjs"
import { query } from "../db.mjs"

const DEFAULTS = { aiEnabled: true }

export async function getSettings(db = { query }) {
  const result = await db.query(
    "SELECT ai_enabled, updated_at FROM skill_trainer.learner_settings WHERE learner_key = $1",
    [config.learnerKey],
  )
  const row = result.rows[0]
  if (!row) return { ...DEFAULTS, updatedAt: null }
  return { aiEnabled: row.ai_enabled, updatedAt: row.updated_at }
}

export async function saveSettings({ aiEnabled }, db = { query }) {
  const result = await db.query(
    `INSERT INTO skill_trainer.learner_settings (learner_key, ai_enabled, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (learner_key) DO UPDATE SET ai_enabled = EXCLUDED.ai_enabled, updated_at = now()
     RETURNING ai_enabled, updated_at`,
    [config.learnerKey, aiEnabled],
  )
  return { aiEnabled: result.rows[0].ai_enabled, updatedAt: result.rows[0].updated_at }
}
