import { askClaude } from "./client.mjs"
import { graderPrompts } from "./prompts.mjs"
import { learnerPhrase, normalizeAnswer } from "../domain/normalize.mjs"

export { normalizeAnswer }

function text(value) {
  return typeof value === "string" ? value.trim() : ""
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

const SUPPORTED_DIMENSIONS = ["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]

const OBSERVATION_SCHEMA = {
  type: "object",
  properties: {
    meaning_match: { type: "string", enum: ["yes", "no"] },
    speech_act_match: { type: "string", enum: ["yes", "no"] },
    comprehensibility: { type: "string", enum: ["clear", "unclear"] },
    target_pattern_status: { type: "string", enum: ["used", "not_used", "not_applicable"] },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          detail: { type: "string" },
          affects_meaning: { type: "boolean" },
          affects_target_skill: { type: "boolean" },
        },
        required: ["type", "detail", "affects_meaning", "affects_target_skill"],
        additionalProperties: false,
      },
    },
    reason: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["meaning_match", "speech_act_match", "comprehensibility", "target_pattern_status", "issues", "reason", "confidence"],
  additionalProperties: false,
}

export function toDimensionResults(observation, outcome, cause) {
  let dims
  if (outcome === "pass" || outcome === "pass_with_note") dims = ["pass", "pass", "pass", "pass", "pass"]
  else if (outcome === "retry_target") {
    const form = observation.issues.some((issue) => issue.affects_target_skill) ? "fail" : "not_observed"
    dims = ["pass", "pass", "pass", form, "fail"]
  } else if (outcome === "retry_form") dims = ["pass", "pass", "pass", "fail", "pass"]
  else {
    dims = [
      cause === "INTENT" ? "pass" : "fail",
      cause === "MEANING" ? "fail" : "not_observed",
      cause === "INTENT" ? "fail" : "not_observed",
      "not_observed",
      "not_observed",
    ]
  }
  return {
    communication: dims[0],
    semantic: dims[1],
    intent: dims[2],
    form: dims[3],
    policy: "pass",
    target_skill_usage: dims[4],
    outcomeLabel: outcome,
    observation: {
      meaningMatch: observation.meaning_match,
      speechActMatch: observation.speech_act_match,
      comprehensibility: observation.comprehensibility,
      targetPatternStatus: observation.target_pattern_status,
      issues: observation.issues,
    },
  }
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

/** 回答を採点する。正解と一致すれば AI を使わない。一致しなければ、文脈が許すときだけ AI に観測させる。 */
export async function gradeDecision(input, context) {
  const trainingMode = text(input?.trainingMode)
  const prompt = text(input?.prompt)
  const expected = text(input?.expectedReference)
  const canonical = text(input?.canonicalForm)
  const meaning = text(input?.meaning)
  const actual = text(input?.answer)
  const declared = input?.requiredDimensions
  const variants = Array.isArray(input?.acceptedVariants) ? input.acceptedVariants : []
  if (!trainingMode || !prompt || !actual) return null
  const unknown = Array.isArray(declared)
    ? declared.find((name) => typeof name !== "string" || !SUPPORTED_DIMENSIONS.includes(name))
    : null
  if (!Array.isArray(declared) || unknown !== undefined) {
    return {
      status: "invalid",
      success: null,
      source: "deterministic",
      observerVersion: "phase1-exact-match-v3",
      reason: `rubric schema invalid: ${Array.isArray(declared) ? `unsupported dimension '${unknown}'` : "rubric required_dimensions missing"}`,
      dimensions: {},
      errorCause: null,
      confidence: null,
      expected,
    }
  }
  const required = declared
  const normalized = normalizeAnswer(actual)
  const matched = normalized === normalizeAnswer(expected) || variants.some((variant) => normalizeAnswer(variant) === normalized)
  if (matched) {
    return {
      status: "graded",
      success: true,
      source: "deterministic",
      observerVersion: "phase1-exact-match-v3",
      reason: learnerFeedback("pass", null, canonical, meaning, actual),
      dimensions: Object.fromEntries(SUPPORTED_DIMENSIONS.map((name) => [name, "pass"])),
      errorCause: null,
      confidence: null,
      expected,
    }
  }
  const unavailableDecision = (message) => ({
    status: "ungraded",
    success: null,
    source: "ai",
    observerVersion: "phase1-observer-ai-v7",
    reason: `grader unavailable: ${message}`,
    dimensions: {},
    errorCause: null,
    confidence: null,
    expected,
  })
  if (!context?.aiAvailable) return unavailableDecision(`AI unavailable: ${context?.aiReason ?? "key_missing"}`)
  const prompts = graderPrompts(trainingMode, required, `${canonical} (${meaning})`, prompt, expected, actual)
  let observation = null
  let lastError = "grader response has no JSON object"
  for (let attempt = 0; attempt < 2 && !observation; attempt += 1) {
    const asked = await askClaude(context, "grade", prompts.system, prompts.user, { maxTokens: 1200, timeoutMs: 45000, jsonSchema: OBSERVATION_SCHEMA })
    if (!asked.ok) {
      lastError = asked.error?.message || asked.code
      continue
    }
    observation = parseObservation(asked.data.text)
    if (!observation) lastError = "parse adaptive grader JSON"
  }
  if (!observation) return unavailableDecision(lastError)
  const reduced = reduceObservation(observation, required)
  const success = reduced.outcome === "pass" || reduced.outcome === "pass_with_note"
  const dimensions = {
    ...toDimensionResults(observation, reduced.outcome, reduced.cause),
    diagnosticReason: observation.reason,
    ...(reduced.outcome === "pass" ? { variantCandidate: actual } : {}),
  }
  return {
    status: "graded",
    success,
    source: "ai",
    observerVersion: "phase1-observer-ai-v7",
    reason: learnerFeedback(reduced.outcome, reduced.cause, canonical, meaning, actual),
    dimensions,
    errorCause: reduced.cause,
    confidence: observation.confidence,
    expected,
  }
}
