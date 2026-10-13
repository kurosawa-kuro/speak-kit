const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 前後の空白を除いた文字列。空や文字列でないものは null。 */
export function text(request, key) {
  const value = request?.[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function isUuid(value) {
  return UUID.test(value || "")
}

/** latency_ms は無くてもよい。あるなら 0 以上・int4 に収まる数。 */
export function latencyOk(value) {
  return typeof value !== "number" || (value >= 0 && value <= 2147483647)
}
