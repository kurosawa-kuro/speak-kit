import { anthropicKey, config } from "../config.mjs"
import { logError } from "../http/errors.mjs"
import { recordUsage } from "./usage.mjs"

export function unavailable(reason) {
  return {
    ok: false,
    code: "ai_unavailable",
    data: { aiAvailable: false, aiReason: reason },
    error: { message: `AI unavailable: ${reason}` },
  }
}

/**
 * AI の窓口。送るかどうかは、操作の文脈（operationContext）だけで決める。
 * 応答が返ったら、使ったトークン数を ai_usage に残す。
 */
export async function askClaude(context, feature, system, user, options = {}) {
  if (!context?.aiAvailable) return unavailable(context?.aiReason ?? "key_missing")
  const key = anthropicKey()
  if (!key) return unavailable("key_missing")
  const model = config.ai.model
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || config.ai.timeoutMs)
  try {
    const response = await fetch(config.ai.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens || config.ai.maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        ...(options.jsonSchema ? { output_config: { format: { type: "json_schema", schema: options.jsonSchema } } } : {}),
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (body?.usage) {
      await recordUsage(feature, body.model || model, body.usage)
        .catch((error) => logError(`ai usage (${feature})`, error))
    }
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
