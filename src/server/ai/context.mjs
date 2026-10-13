import { anthropicKey, config } from "../config.mjs"
import { query } from "../db.mjs"
import { getSettings } from "../services/settings.mjs"
import { overLimit, usageTotals } from "./usage.mjs"

/**
 * 1 回の操作の「文脈」。AI を使えるかは、操作の最初にここで 1 度だけ決める。
 * aiReason は setting_off（設定でオフ）/ key_missing（キーが無い）/ limit_reached（利用上限）/ null。
 */
export async function operationContext(db = { query }) {
  const settings = await getSettings(db)
  const keyConfigured = anthropicKey() !== null
  const usage = await usageTotals(db)
  const aiReason = !settings.aiEnabled
    ? "setting_off"
    : !keyConfigured
      ? "key_missing"
      : overLimit(usage)
        ? "limit_reached"
        : null
  return {
    learnerKey: config.learnerKey,
    settings,
    keyConfigured,
    usage,
    aiAvailable: aiReason === null,
    aiReason,
  }
}

/** 画面へ返す形。 */
export function availability(context) {
  return { aiAvailable: context.aiAvailable, aiReason: context.aiReason }
}
