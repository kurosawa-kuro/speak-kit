import { availability, operationContext } from "./ai/context.mjs"
import { startupSettings } from "./config.mjs"
import { envelope, validationError } from "./http/envelope.mjs"
import { isUuid, latencyOk, text } from "./http/validate.mjs"
import { query } from "./db.mjs"
import { quizAnswer, quizNext } from "./services/quiz.mjs"
import { getProgress, getTodayPlan, resetReview } from "./services/plan.mjs"
import { getPractice } from "./services/practice.mjs"
import { compareObservations, recordHumanObservation, regradeAttempt, submitFreeText } from "./services/attempt.mjs"
import { endTalkSession, sendTalkMessage, startTalkSession } from "./services/talk.mjs"
import { evaluatePhaseGate, getTrace } from "./services/gate.mjs"
import { registerPair, submitProbe } from "./services/confusion.mjs"
import { reviewCandidate } from "./services/candidates.mjs"
import { getSettings, saveSettings } from "./services/settings.mjs"
import { RPC_NAMES } from "./rpc-names.mjs"

const TALK = new Set(["teacher", "learner", "free_talk"])

/** 応答を返したあとに走らせる仕事。route からは next/server の after を渡す。 */
function detached(task) {
  setImmediate(() => {
    Promise.resolve().then(task).catch(() => {})
  })
}

async function domainFor(request) {
  const code = text(request, "domain_code") || "english_conversation"
  const domain = await query("SELECT id FROM skill_trainer.domains WHERE code = $1", [code])
  return domain.rows[0] ? { code, id: domain.rows[0].id } : null
}

async function settingsView() {
  const context = await operationContext()
  return envelope(true, "ok", {
    settings: { aiEnabled: context.settings.aiEnabled, updatedAt: context.settings.updatedAt },
    ai: { ...availability(context), keyConfigured: context.keyConfigured, usage: context.usage },
    startup: startupSettings(),
  }, null)
}

async function submitAttempt(operation, request) {
  const mode = request?.response_mode
  if (mode === "choice") return quizAnswer(request)
  if (mode === "confusion_probe") {
    if (!isUuid(text(request, "submission_id"))) return validationError("submission_id must be a UUID")
    if (!isUuid(text(request, "probe_id"))) return validationError("probe_id must be a UUID")
    if (!text(request, "answer_text")) return validationError("answer_text is required")
    return submitProbe(operation, request)
  }
  if (mode != null && mode !== "free_text") return validationError("unsupported response_mode")
  if (!isUuid(text(request, "attempt_id"))) return validationError("attempt_id must be a UUID")
  if (!isUuid(text(request, "exercise_instance_id"))) return validationError("exercise_instance_id must be a UUID")
  if (!text(request, "answer_text")) return validationError("answer_text is required")
  if (!latencyOk(request?.latency_ms)) return validationError("latency_ms must be between 0 and 2147483647")
  return submitFreeText(operation, request)
}

async function startTalk(operation, request) {
  const scenario = text(request, "scenario")
  if (!scenario) return validationError("scenario is required")
  const domain = await domainFor(request)
  if (!domain) return validationError("unknown domain_code")
  if (domain.code === "english_conversation" && !TALK.has(scenario)) {
    return validationError("scenario must be one of teacher, learner, free_talk for this domain")
  }
  if (!isUuid(text(request, "session_id"))) return validationError("session_id must be a valid UUID")
  return startTalkSession(operation, request, domain.id)
}

async function route(name, request, operation) {
  switch (name) {
    case "skill_trainer_get_today_plan_v2":
      return getTodayPlan(operation, request)
    case "skill_trainer_get_practice_v2":
      return getPractice(operation, request)
    case "skill_trainer_submit_attempt_v2":
      return submitAttempt(operation, request)
    case "skill_trainer_register_confusion_pair_v2":
      if (!text(request, "label_a")) return validationError("label_a is required")
      if (!text(request, "label_b")) return validationError("label_b is required")
      if (text(request, "label_a").toLowerCase() === text(request, "label_b").toLowerCase()) {
        return validationError("the two labels must differ")
      }
      return registerPair(operation, request)
    case "skill_trainer_regrade_attempt_v2":
      if (!isUuid(text(request, "regrade_id"))) return validationError("regrade_id must be a UUID")
      if (!isUuid(text(request, "attempt_id"))) return validationError("attempt_id must be a UUID")
      return regradeAttempt(operation, request)
    case "skill_trainer_record_human_observation_v2":
      if (!isUuid(text(request, "observation_id"))) return validationError("observation_id must be a UUID")
      if (!isUuid(text(request, "attempt_id"))) return validationError("attempt_id must be a UUID")
      if (!request?.dimensions || typeof request.dimensions !== "object" || Array.isArray(request.dimensions)) {
        return validationError("dimensions must be an object")
      }
      if (!text(request, "reason")) return validationError("reason is required")
      return recordHumanObservation(operation, request)
    case "skill_trainer_compare_observations_v2":
      if (!isUuid(text(request, "attempt_id"))) return validationError("attempt_id must be a UUID")
      return compareObservations(request)
    case "skill_trainer_get_progress_v2":
      return getProgress(request)
    case "skill_trainer_reset_review_v2": {
      const domain = await domainFor(request)
      if (!domain) return validationError("unknown domain_code")
      return resetReview(operation, domain.id)
    }
    case "skill_trainer_quiz_next_v1":
      return quizNext(request)
    case "skill_trainer_start_talk_session_v2":
      return startTalk(operation, request)
    case "skill_trainer_send_talk_message_v2":
      if (!Number.isSafeInteger(request?.conversation_session_id)) {
        return validationError("conversation_session_id is required")
      }
      if (!isUuid(text(request, "turn_id"))) return validationError("turn_id must be a UUID")
      if (!text(request, "message")) return validationError("message is required")
      if (!latencyOk(request?.latency_ms)) return validationError("latency_ms must be between 0 and 2147483647")
      return sendTalkMessage(operation, request)
    case "skill_trainer_end_talk_session_v2":
      if (!Number.isSafeInteger(request?.conversation_session_id)) {
        return validationError("conversation_session_id is required")
      }
      return endTalkSession(operation, request)
    case "skill_trainer_get_trace_v2":
      if (!isUuid(text(request, "plan_item_id"))) return validationError("plan_item_id must be a UUID")
      return getTrace(request)
    case "skill_trainer_evaluate_phase_gate_v2": {
      const domain = await domainFor(request)
      if (!domain) return validationError("unknown domain_code")
      const phase = request?.phase
      if (phase != null && phase !== 1) return validationError("only Phase 1 gate is defined")
      return evaluatePhaseGate(request, domain.id)
    }
    case "skill_trainer_review_candidate_v2":
      if (!Number.isSafeInteger(request?.candidate_id)) return validationError("candidate_id is required")
      if (!["approved", "rejected"].includes(text(request, "decision"))) {
        return validationError("decision must be approved or rejected")
      }
      if (!text(request, "reviewed_by")) return validationError("reviewed_by is required")
      return reviewCandidate(operation, request)
    case "skill_trainer_get_settings_v1":
      return settingsView()
    case "skill_trainer_save_settings_v1":
      if (typeof request?.ai_enabled !== "boolean") return validationError("ai_enabled must be true or false")
      await saveSettings({ aiEnabled: request.ai_enabled })
      return settingsView()
    default:
      return null
  }
}

/** 名前が無ければ null。AI を使えるか（文脈）は、操作の最初に 1 度だけ決める。 */
export async function dispatch(name, request, { defer = detached } = {}) {
  if (!RPC_NAMES.includes(name)) return null
  const operation = { ...(await operationContext()), defer }
  return route(name, request || {}, operation)
}
