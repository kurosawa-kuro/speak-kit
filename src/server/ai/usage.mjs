import { config } from "../config.mjs"
import { query } from "../db.mjs"

/** 応答の usage（トークン数）から金額（ドル）を出す。 */
export function costUsd(model, inputTokens, outputTokens) {
  const price = config.ai.pricesPerMTok[model] ?? config.ai.fallbackPricePerMTok
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}

/** 今日と今月（config.timeZone の暦）の使用額。 */
export async function usageTotals(db = { query }) {
  const result = await db.query(
    `SELECT
       coalesce(sum(cost_usd) FILTER (
         WHERE called_at >= date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2), 0)::float8 AS day,
       coalesce(sum(cost_usd), 0)::float8 AS month
     FROM skill_trainer.ai_usage
     WHERE learner_key = $1
       AND called_at >= date_trunc('month', now() AT TIME ZONE $2) AT TIME ZONE $2`,
    [config.learnerKey, config.timeZone],
  )
  const row = result.rows[0]
  return {
    dayUsd: Number(row.day),
    monthUsd: Number(row.month),
    dailyLimitUsd: config.ai.dailyLimitUsd,
    monthlyLimitUsd: config.ai.monthlyLimitUsd,
  }
}

export function overLimit(totals) {
  return totals.dayUsd >= totals.dailyLimitUsd || totals.monthUsd >= totals.monthlyLimitUsd
}

export async function recordUsage(feature, model, usage, db = { query }) {
  const input = Number.isInteger(usage?.input_tokens) ? usage.input_tokens : 0
  const output = Number.isInteger(usage?.output_tokens) ? usage.output_tokens : 0
  await db.query(
    `INSERT INTO skill_trainer.ai_usage (learner_key, feature, model, input_tokens, output_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [config.learnerKey, feature, model, input, output, costUsd(model, input, output)],
  )
}
