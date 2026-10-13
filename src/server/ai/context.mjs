import { getSettings } from "../settings.mjs"

export const AI_REASON_MESSAGES = {
  setting_off: "設定で AI をオフにしています",
  key_missing: "API キーが未設定です",
}

export function hasAnthropicKey() {
  const key = process.env.ANTHROPIC_API_KEY
  return typeof key === "string" && key.trim().length > 0
}

/** AI を使えるかを、設定とキーの有無から 1 か所で決める。キーの値は返さない。 */
export async function aiStatus() {
  const keyConfigured = hasAnthropicKey()
  const setting = (await getSettings()).aiEnabled
  const reason = !setting ? "setting_off" : !keyConfigured ? "key_missing" : null
  return { aiEnabled: reason === null, keyConfigured, setting, reason }
}

/** 画面へ返す形。aiReason は setting_off / key_missing / null。 */
export async function aiAvailability() {
  const status = await aiStatus()
  return { aiAvailable: status.aiEnabled, aiReason: status.reason }
}

export async function aiEnabled() {
  if (!hasAnthropicKey()) return false
  return (await aiStatus()).aiEnabled
}
