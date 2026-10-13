import { aiEnabled } from "./isEnabled.mjs"

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
const TIMEOUT_MS = 20000

export function unavailable() {
  return {
    ok: false,
    code: "ai_unavailable",
    data: { aiEnabled: false },
    error: { message: "ANTHROPIC_API_KEY is unset" },
  }
}

export async function askClaude(system, user, options = {}) {
  if (!aiEnabled()) return unavailable()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || TIMEOUT_MS)
  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: options.maxTokens || 600,
        system,
        messages: [{ role: "user", content: user }],
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const code = response.status === 401 ? "unauthorized" : response.status === 429 ? "rate_limited" : "ai_error"
      return { ok: false, code, data: {}, error: { message: body?.error?.message || `Anthropic ${response.status}` } }
    }
    const text = (body.content || []).map((block) => block.text || "").join("").trim()
    return { ok: true, code: "ok", data: { text }, error: null }
  } catch (error) {
    const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError"
    return {
      ok: false,
      code: timedOut ? "timeout" : "ai_error",
      data: {},
      error: { message: timedOut ? "Anthropic request timed out" : "Anthropic request failed" },
    }
  } finally {
    clearTimeout(timer)
  }
}
