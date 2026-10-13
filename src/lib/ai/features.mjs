import { aiGate, askClaude } from "./client.mjs"
import { OPENING_FALLBACK, PERSONAS, TURN_FALLBACK } from "./prompts.mjs"

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

function parseJson(raw) {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function talk(request) {
  const blocked = await aiGate()
  if (blocked) return blocked
  const scenario = text(request?.scenario)
  const persona = PERSONAS[scenario]
  if (!persona) {
    return { ok: false, code: "validation_error", data: {}, error: { message: "scenario must be one of teacher, learner, free_talk" } }
  }
  const message = text(request?.message)
  const history = Array.isArray(request?.history) ? request.history.slice(-8) : []
  const historyText = history
    .map((turn) => `${turn.role === "learner" ? "学習者" : "相手"}: ${text(turn.content)}`)
    .filter((line) => !line.endsWith(": "))
    .join("\n")
  const user = message
    ? `これまでの会話:\n${historyText || "(なし)"}\n\n学習者の最新の発言: ${message}\n\n次のJSONだけを返してください。\n{"reply":"1〜3文の英語"}`
    : `次のJSONだけを返してください。\n{"reply":"会話を始める最初の英語の発言(1〜2文)"}`
  const asked = await askClaude(`${persona}\nJSON以外は出力しないでください。`, user)
  if (!asked.ok) {
    return { ...asked, data: { ...asked.data, reply: message ? TURN_FALLBACK : OPENING_FALLBACK } }
  }
  const parsed = parseJson(asked.data.text)
  return { ok: true, code: "ok", data: { reply: text(parsed?.reply) || asked.data.text, aiEnabled: true }, error: null }
}

export async function feedback(request) {
  const blocked = await aiGate()
  if (blocked) return blocked
  const sentence = text(request?.text)
  if (!sentence) {
    return { ok: false, code: "validation_error", data: {}, error: { message: "text is required" } }
  }
  const asked = await askClaude(
    "あなたは英会話の添削者です。音声は扱いません。文法と自然さを短く日本語で見ます。JSON以外は出力しないでください。",
    `学習者の文: ${sentence}\n{"grammar":"短い日本語","naturalness":"短い日本語","rewrite":"より自然な英語1文"}`,
  )
  if (!asked.ok) return asked
  const parsed = parseJson(asked.data.text)
  return {
    ok: true,
    code: "ok",
    data: {
      grammar: text(parsed?.grammar) || asked.data.text,
      naturalness: text(parsed?.naturalness),
      rewrite: text(parsed?.rewrite),
      aiEnabled: true,
    },
    error: null,
  }
}

export async function scenario() {
  const blocked = await aiGate()
  if (blocked) return blocked
  const asked = await askClaude(
    "あなたはPhase 1の英会話教材を1場面だけ作ります。自己紹介、質問、時間、依頼、聞き返しのどれかです。JSON以外は出力しないでください。",
    '{"situation":"日本語で1文の場面","opener":"相手の最初の英語1〜2文"}',
  )
  if (!asked.ok) return asked
  const parsed = parseJson(asked.data.text)
  return {
    ok: true,
    code: "ok",
    data: {
      situation: text(parsed?.situation) || asked.data.text,
      opener: text(parsed?.opener),
      aiEnabled: true,
    },
    error: null,
  }
}
