import { randomUUID } from "node:crypto"
import { envelope, validationError } from "./envelope.mjs"
import { aiEnabled } from "./ai/isEnabled.mjs"
import { query } from "./db.mjs"
import { quizAnswer, quizNext } from "./quiz.mjs"
import { getProgress, getTodayPlan } from "./plan.mjs"
import { getPractice } from "./practice.mjs"
import { regradeAttempt, submitFreeText } from "./attempt.mjs"
import { endTalkSession, sendTalkMessage, startTalkSession } from "./talk.mjs"
import { evaluatePhaseGate } from "./gate.mjs"
import { registerPair, submitProbe } from "./confusion.mjs"
import { reviewCandidate } from "./candidates.mjs"
import { RPC_NAMES } from "./rpc-names.mjs"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function text(request, key) {
  const value = request?.[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isUuid(value) {
  return UUID.test(value || "")
}

const TALK = new Set(["teacher", "learner", "free_talk"])

function aiOff() {
  return envelope(false, "ai_unavailable", { aiAvailable: false }, {
    message: "ANTHROPIC_API_KEY is unset",
  })
}

async function submitAttempt(request) {
  const mode = request?.response_mode
  if (mode === "choice") return quizAnswer(request)
  if (mode === "confusion_probe") {
    if (!isUuid(text(request, "submission_id"))) return validationError("submission_id must be a UUID")
    if (!isUuid(text(request, "probe_id"))) return validationError("probe_id must be a UUID")
    if (!text(request, "answer_text")) return validationError("answer_text is required")
    return submitProbe(request)
  }
  if (mode != null && mode !== "free_text") return validationError("unsupported response_mode")
  if (!isUuid(text(request, "attempt_id"))) return validationError("attempt_id must be a UUID")
  if (!isUuid(text(request, "exercise_instance_id"))) return validationError("exercise_instance_id must be a UUID")
  if (!text(request, "answer_text")) return validationError("answer_text is required")
  const latency = request?.latency_ms
  if (typeof latency === "number" && (latency < 0 || latency > 2147483647)) {
    return validationError("latency_ms must be between 0 and 2147483647")
  }
  return submitFreeText(request)
}

async function startTalk(request) {
  const scenario = text(request, "scenario")
  if (!scenario) return validationError("scenario is required")
  const code = text(request, "domain_code") || "english_conversation"
  if (code === "english_conversation" && !TALK.has(scenario)) {
    return validationError("scenario must be one of teacher, learner, free_talk for this domain")
  }
  if (!isUuid(text(request, "session_id"))) return validationError("session_id must be a valid UUID")
  const domain = await query("SELECT id FROM skill_trainer.domains WHERE code = $1", [code])
  if (!domain.rows[0]) return validationError("unknown domain_code")
  return startTalkSession(request, domain.rows[0].id)
}

export async function dispatch(name, request) {
  if (!RPC_NAMES.includes(name)) return null
  switch (name) {
    case "skill_trainer_get_today_plan_v2":
      return getTodayPlan(request || {})
    case "skill_trainer_get_practice_v2":
      return getPractice(request || {})
    case "skill_trainer_submit_attempt_v2":
      return submitAttempt(request || {})
    case "skill_trainer_register_confusion_pair_v2":
      if (!text(request, "label_a")) return validationError("label_a is required")
      if (!text(request, "label_b")) return validationError("label_b is required")
      if (text(request, "label_a").toLowerCase() === text(request, "label_b").toLowerCase()) {
        return validationError("the two labels must differ")
      }
      if (!aiEnabled()) {
        return envelope(false, "confusion_key_unavailable", {}, { message: "ANTHROPIC_API_KEY is unset" })
      }
      return registerPair(request)
    case "skill_trainer_regrade_attempt_v2":
      if (!isUuid(text(request, "regrade_id"))) return validationError("regrade_id must be a UUID")
      if (!isUuid(text(request, "attempt_id"))) return validationError("attempt_id must be a UUID")
      return regradeAttempt(request)
    case "skill_trainer_record_human_observation_v2":
      if (!isUuid(text(request, "observation_id"))) return validationError("observation_id must be a UUID")
      if (!isUuid(text(request, "attempt_id"))) return validationError("attempt_id must be a UUID")
      if (!request?.dimensions || typeof request.dimensions !== "object" || Array.isArray(request.dimensions)) {
        return validationError("dimensions must be an object")
      }
      if (!text(request, "reason")) return validationError("reason is required")
      const found = await query("SELECT 1 FROM skill_trainer.training_attempts WHERE attempt_id = $1", [text(request, "attempt_id")])
      if (!found.rows[0]) return envelope(false, "not_found", {}, { message: "attempt not found" })
      return envelope(false, "ai_unavailable", { aiAvailable: false }, { message: "ANTHROPIC_API_KEY is unset" })
    case "skill_trainer_compare_observations_v2":
      if (!isUuid(text(request, "attempt_id"))) return validationError("attempt_id must be a UUID")
      return envelope(true, "ok", { attemptId: text(request, "attempt_id"), observationCount: 0, observations: [] }, null)
    case "skill_trainer_get_progress_v2":
      return getProgress(request || {})
    case "skill_trainer_reset_review_v2": {
      const code = text(request, "domain_code") || "english_conversation"
      const domain = await query("SELECT id FROM skill_trainer.domains WHERE code = $1", [code])
      if (!domain.rows[0]) return validationError("unknown domain_code")
      const inserted = await query(
        `INSERT INTO skill_trainer.review_resets (reset_id, learner_key, domain_id)
         VALUES ($1, 'default', $2) RETURNING requested_at`,
        [randomUUID(), domain.rows[0].id],
      )
      return envelope(true, "ok", { requestedAt: inserted.rows[0].requested_at }, null)
    }
    case "skill_trainer_quiz_next_v1":
      return quizNext(request || {})
    case "skill_trainer_start_talk_session_v2":
      return startTalk(request || {})
    case "skill_trainer_send_talk_message_v2":
      if (request?.conversation_session_id == null || request.conversation_session_id === "") {
        return validationError("conversation_session_id is required")
      }
      if (!isUuid(text(request, "turn_id"))) return validationError("turn_id must be a UUID")
      if (!text(request, "message")) return validationError("message is required")
      return sendTalkMessage(request)
    case "skill_trainer_end_talk_session_v2":
      if (request?.conversation_session_id == null || request.conversation_session_id === "") {
        return validationError("conversation_session_id is required")
      }
      return endTalkSession(request)
    case "skill_trainer_get_trace_v2":
      if (!isUuid(text(request, "attempt_id"))) return validationError("attempt_id must be a UUID")
      return envelope(true, "ok", { attemptId: text(request, "attempt_id"), observations: [] }, null)
    case "skill_trainer_evaluate_phase_gate_v2": {
      const code = text(request, "domain_code") || "english_conversation"
      const domain = await query("SELECT id FROM skill_trainer.domains WHERE code = $1", [code])
      if (!domain.rows[0]) return validationError("unknown domain_code")
      const phase = request?.phase
      if (phase != null && phase !== 1) return validationError("only Phase 1 gate is defined")
      return evaluatePhaseGate(request, domain.rows[0].id)
    }
    case "skill_trainer_review_candidate_v2":
      if (!text(request, "candidate_id")) return validationError("candidate_id is required")
      if (!text(request, "decision")) return validationError("decision is required")
      if (!["approved", "rejected"].includes(text(request, "decision"))) {
        return validationError("decision must be approved or rejected")
      }
      if (!text(request, "reviewed_by")) return validationError("reviewed_by is required")
      return reviewCandidate(request)
    default:
      return null
  }
}
