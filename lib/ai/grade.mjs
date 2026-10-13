import { askClaude } from "./client.mjs"
import { aiEnabled } from "./isEnabled.mjs"

const CONTRACTIONS = {
  "i'm": "i am",
  "what's": "what is",
  "that's": "that is",
  "it's": "it is",
  "let's": "let us",
  "you're": "you are",
  "we're": "we are",
  "they're": "they are",
  "don't": "do not",
  "can't": "cannot",
  "couldn't": "could not",
  "wouldn't": "would not",
  "isn't": "is not",
  "aren't": "are not",
  "didn't": "did not",
  "doesn't": "does not",
  "wasn't": "was not",
  "weren't": "were not",
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

export function normalizeAnswer(input) {
  const lowered = text(input).toLowerCase().replaceAll("’", "'")
  const stripped = lowered.replace(/[?.!,]+$/u, "").replaceAll(/[,;:]/g, " ")
  return stripped
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => CONTRACTIONS[token] || token)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
}

export function learnerPhrase(canonical) {
  let phrase = ""
  let rest = canonical || ""
  while (rest.includes("{")) {
    const start = rest.indexOf("{")
    phrase += rest.slice(0, start)
    rest = rest.slice(start + 1)
    const end = rest.indexOf("}")
    if (end >= 0) {
      phrase += "..."
      rest = rest.slice(end + 1)
    } else {
      phrase += "{"
      break
    }
  }
  return phrase + rest
}

export function learnerFeedback(outcomeLabel, cause, canonical, meaning, actual) {
  const phrase = learnerPhrase(canonical)
  const gloss = text(meaning)
  const named = gloss ? `「${phrase}」（${gloss}）` : `「${phrase}」`
  const typed = text(actual)
  if (outcomeLabel === "pass") return `意味も、今回の言い方${named}も合っています。`
  if (outcomeLabel === "pass_with_note") {
    return `意味は伝わっていて、今回の言い方${named}も使えています。細かい揺れは次で直せば十分です。`
  }
  if (outcomeLabel === "retry_target") {
    if (!typed) return `意味は伝わっています。今回は${named}を使う練習です。まずこの形を使ってみましょう。`
    return `意味は伝わっています。今回は${named}を使う練習です。「${typed}」ではなく、まずこの形を使ってみましょう。`
  }
  if (outcomeLabel === "retry_form") {
    return `意味は伝わっています。今回の言い方は${named}です。この形の一部が足りないので、回答例と同じ形でもう一度書いてみましょう。`
  }
  if (outcomeLabel === "fail_communication" && cause === "INTENT") {
    return `文としては読めますが、今回の場面の言い方になっていません。今回は${named}を使う練習です。`
  }
  return `まだ意味が相手に届いていません。今回は${named}を使う練習です。回答例の形をそのまま使ってみましょう。`
}

export function graderPrompts(trainingMode, requiredDimensions, targetSkillLabel, prompt, expected, actual) {
  const targetRequired = requiredDimensions.includes("target_skill_usage")
  const applicableHint = targetRequired ? "" : "/not_applicable"
  const applicable = targetRequired ? "" : "|not_applicable"
  const system = `あなたはCore30の取り出しを観測します。Training Modeは${trainingMode}です。自然な英文かではなく、指定された言い方を会話の目的に沿って使えたかを見てください。合否は決めません。JSON以外は書かないでください。
1. target_pattern_status: 「${targetSkillLabel}」の形を使ったか（used/not_used${applicableHint}）。別の正しい英語でも、この形でなければnot_used。
2. meaning_match / speech_act_match: お題の意味と意図がおおむね成立するか。typo、冠詞、句読点、大文字小文字、意味を壊さない軽い文法ではnoにしない。
3. comprehensibility: 文として読めるならclear。通信できないときだけunclear。
4. issues: 上の軽微な点だけを空でもよい配列で。typo・冠詞・句読点はaffects_meaning=false かつ affects_target_skill=false。
reasonは40文字以内の日本語。issue.detailは20文字以内。`
  const user = `お題: ${prompt}
期待する言い方: ${expected}
学習者: ${actual}
{"meaning_match":"yes|no","speech_act_match":"yes|no","comprehensibility":"clear|unclear","target_pattern_status":"used|not_used${applicable}","issues":[{"type":"TYPO","detail":"短い日本語","affects_meaning":false,"affects_target_skill":false}],"reason":"短い日本語","confidence":0.0}`
  return { system, user }
}

export function reduceObservation(observation, requiredDimensions) {
  const targetRequired = requiredDimensions.includes("target_skill_usage")
  const meaningOk = observation.meaning_match === "yes"
  const intentOk = observation.speech_act_match === "yes"
  if (observation.comprehensibility === "unclear") {
    return { outcome: "fail_communication", cause: intentOk ? "MEANING" : "INTENT" }
  }
  if (targetRequired && observation.target_pattern_status === "not_used") {
    if (meaningOk && intentOk) return { outcome: "retry_target", cause: "FORM_SELECTION" }
    return { outcome: "fail_communication", cause: intentOk ? "MEANING" : "INTENT" }
  }
  if (!meaningOk) return { outcome: "fail_communication", cause: "MEANING" }
  if (!intentOk) return { outcome: "fail_communication", cause: "INTENT" }
  if (Array.isArray(observation.issues) && observation.issues.length > 0) return { outcome: "pass_with_note", cause: null }
  return { outcome: "pass", cause: null }
}

function parseObservation(raw) {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end < start) return null
  let observation
  try {
    observation = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  const meaning = observation.meaning_match
  const speech = observation.speech_act_match
  const clarity = observation.comprehensibility
  const pattern = observation.target_pattern_status
  if (!["yes", "no"].includes(meaning) || !["yes", "no"].includes(speech)) return null
  if (!["clear", "unclear"].includes(clarity)) return null
  if (!["used", "not_used", "not_applicable"].includes(pattern)) return null
  if (typeof observation.reason !== "string" || !observation.reason.trim()) return null
  if (typeof observation.confidence !== "number" || observation.confidence < 0 || observation.confidence > 1) return null
  const issues = Array.isArray(observation.issues) ? observation.issues : []
  return { ...observation, issues }
}

function notice(status, success, detail, expected) {
  const ungraded = status !== "graded"
  return {
    ok: true,
    code: "ok",
    data: {
      gradingStatus: status,
      outcome: success === true ? "success" : success === false ? "failure" : null,
      title: ungraded ? "確認できませんでした" : success ? "成功" : "要復習",
      detail,
      expected,
      retry: ungraded,
      aiEnabled: aiEnabled(),
    },
    error: null,
  }
}

export async function gradeDecision(input) {
  const trainingMode = text(input?.trainingMode)
  const prompt = text(input?.prompt)
  const expected = text(input?.expectedReference)
  const canonical = text(input?.canonicalForm)
  const meaning = text(input?.meaning)
  const actual = text(input?.answer)
  const required = Array.isArray(input?.requiredDimensions) ? input.requiredDimensions.filter((name) => typeof name === "string") : []
  const variants = Array.isArray(input?.acceptedVariants) ? input.acceptedVariants : []
  if (!trainingMode || !prompt || !actual) return null
  const normalized = normalizeAnswer(actual)
  const matched = normalized === normalizeAnswer(expected) || variants.some((variant) => normalizeAnswer(variant) === normalized)
  if (matched) {
    return {
      status: "graded",
      success: true,
      source: "deterministic",
      observerVersion: "phase1-exact-match-v3",
      reason: learnerFeedback("pass", null, canonical, meaning, actual),
      dimensions: { deterministic_outcome: "pass" },
      errorCause: null,
      confidence: null,
      expected,
    }
  }
  if (!aiEnabled()) {
    return {
      status: "ungraded",
      success: null,
      source: "ai",
      observerVersion: "phase1-observer-ai-v7",
      reason: "正解を見て、もう一度この形を出してみましょう。",
      dimensions: {},
      errorCause: null,
      confidence: null,
      expected,
    }
  }
  const prompts = graderPrompts(trainingMode, required, `${canonical} (${meaning})`, prompt, expected, actual)
  let observation = null
  for (let attempt = 0; attempt < 2 && !observation; attempt += 1) {
    const asked = await askClaude(prompts.system, prompts.user, { maxTokens: 1200, timeoutMs: 45000 })
    if (!asked.ok) continue
    observation = parseObservation(asked.data.text)
  }
  if (!observation) {
    return {
      status: "ungraded",
      success: null,
      source: "ai",
      observerVersion: "phase1-observer-ai-v7",
      reason: "正解を見て、もう一度この形を出してみましょう。",
      dimensions: {},
      errorCause: null,
      confidence: null,
      expected,
    }
  }
  const reduced = reduceObservation(observation, required)
  const success = reduced.outcome === "pass" || reduced.outcome === "pass_with_note"
  return {
    status: "graded",
    success,
    source: "ai",
    observerVersion: "phase1-observer-ai-v7",
    reason: learnerFeedback(reduced.outcome, reduced.cause, canonical, meaning, actual),
    dimensions: observation,
    errorCause: reduced.cause,
    confidence: typeof observation.confidence === "number" ? Math.min(1, Math.max(0, observation.confidence)) : null,
    expected,
  }
}

export async function gradeAttempt(request) {
  const decision = await gradeDecision(request)
  if (!decision) {
    return { ok: false, code: "validation_error", data: {}, error: { message: "trainingMode, prompt, and answer are required" } }
  }
  return notice(decision.status, decision.success, decision.reason, decision.expected)
}
