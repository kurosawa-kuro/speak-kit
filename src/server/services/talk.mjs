import { randomUUID } from "node:crypto"
import { askClaude } from "../ai/client.mjs"
import { availability } from "../ai/context.mjs"
import {
  CANDIDATE_EXTRACTION_SYSTEM,
  OPENING_FALLBACK,
  OPENING_USER,
  PERSONAS,
  TURN_FALLBACK,
  candidateUser,
  turnSystem,
  turnUser,
} from "../ai/prompts.mjs"
import { normalizeAnswer } from "../domain/normalize.mjs"
import { hashParts } from "../domain/hash.mjs"
import { envelope } from "../http/envelope.mjs"
import { query, withTransaction } from "../db.mjs"
import { DERIVATION, loadPolicy } from "./learning.mjs"

// 会話の AI（最初の一言、各ターンの判定、候補の抽出）は、トランザクションの外で呼ぶ。
// 書き込みは AI の結果を持ってから短いトランザクションで行い、再送の確認はその中でもう一度行う。

const OBSERVER = "phase1-talk-ai-v2"
const METRICS = "phase1-talk-metrics-v2"

const CATEGORIES = ["OUTPUT", "QUERY", "TIME", "ACTION", "ERROR_HANDLING"]
const NO_METRICS = { selfQuestion: false, followUp: false, errorHandling: false, freeze: false, japaneseFallback: false }

function jsonObject(raw) {
  const trimmed = String(raw || "").trim()
  let text = trimmed
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start >= 0 && start < end) text = trimmed.slice(start, end + 1)
  }
  return JSON.parse(text)
}

async function askJudge(context, feature, system, user, maxTokens) {
  const asked = await askClaude(context, feature, system, user, { maxTokens, timeoutMs: 45000 })
  if (!asked.ok) throw new Error(asked.error?.message || asked.code)
  return jsonObject(asked.data.text)
}

async function generateOpening(context, scenario) {
  const parsed = await askJudge(
    context,
    "talk_opening",
    `${PERSONAS[scenario]}\nこれは会話の最初のターンです。自然な一言で会話を始めてください。`,
    OPENING_USER,
    150,
  )
  if (typeof parsed.reply !== "string") throw new Error("parse ai judge json")
  return parsed.reply
}

async function judgeTurn(context, scenario, history, message) {
  const historyText = history
    .slice(-10)
    .map((row) => `${row.role === "assistant" ? "AI" : "User"}: ${row.content}`)
    .join("\n")
  const parsed = await askJudge(context, "talk_turn", turnSystem(PERSONAS[scenario]), turnUser(historyText, message), 300)
  if (typeof parsed.reply !== "string") throw new Error("parse ai judge json")
  const flag = (key) => {
    if (parsed[key] == null) return false
    if (typeof parsed[key] !== "boolean") throw new Error("parse ai judge json")
    return parsed[key]
  }
  return {
    reply: parsed.reply,
    selfQuestion: flag("selfQuestion"),
    followUp: flag("followUp"),
    errorHandling: flag("errorHandling"),
    freeze: flag("freeze"),
    japaneseFallback: flag("japaneseFallback"),
  }
}

async function extractCandidates(context, scenario, contexts, existing) {
  const scenes = contexts
    .map((row, index) => `場面${index + 1}:\nAI: ${row.previous ?? "(会話の最初のターン)"}\n学習者: ${row.content}`)
    .join("\n\n")
  const existingList = existing.length
    ? existing.map((row) => `id=${row.id}: ${row.pattern} (${row.meaning})`).join("\n")
    : "(なし)"
  const parsed = await askJudge(context, "talk_candidates", CANDIDATE_EXTRACTION_SYSTEM, candidateUser(scenario, scenes, existingList), 700)
  const list = parsed.candidates == null ? [] : parsed.candidates
  if (!Array.isArray(list)) throw new Error("parse ai judge json")
  return list.map((item) => {
    if (typeof item?.pattern !== "string" || typeof item.meaning !== "string" || typeof item.category !== "string") {
      throw new Error("parse ai judge json")
    }
    const hint = item.existingCandidateId ?? item.existing_candidate_id
    return {
      pattern: item.pattern,
      meaning: item.meaning,
      category: item.category,
      existingCandidateId: Number.isInteger(hint) ? hint : null,
    }
  })
}

export async function startTalkSession(context, request, domainId) {
  const scenario = request.scenario.trim()
  const sessionId = request.session_id.trim()
  const inserted = await query(
    `INSERT INTO skill_trainer.conversation_sessions
       (learner_key, scenario, session_id, metrics_version, domain_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id) DO NOTHING
     RETURNING id`,
    [context.learnerKey, scenario, sessionId, METRICS, domainId],
  )
  let conversationSessionId = inserted.rows[0]?.id
  let storedScenario = scenario
  let replayed = false
  if (conversationSessionId == null) {
    const stored = await query(
      `SELECT id, scenario, domain_id FROM skill_trainer.conversation_sessions WHERE session_id = $1`,
      [sessionId],
    )
    const row = stored.rows[0]
    if (row.scenario !== scenario || String(row.domain_id) !== String(domainId)) {
      return envelope(false, "idempotency_conflict", {}, { message: "session_id was already used for another scenario or domain" })
    }
    conversationSessionId = row.id
    storedScenario = row.scenario
    replayed = true
  }
  conversationSessionId = Number(conversationSessionId)
  const existing = await query(
    `SELECT content FROM skill_trainer.conversation_turns
     WHERE conversation_session_id = $1 AND turn_index = 0 AND role = 'assistant'`,
    [conversationSessionId],
  )
  let opening = existing.rows[0]?.content
  if (opening == null) {
    let content
    try {
      content = await generateOpening(context, storedScenario)
    } catch (error) {
      console.warn("adaptive talk opening unavailable", conversationSessionId, error.message)
      content = OPENING_FALLBACK
    }
    opening = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO skill_trainer.conversation_turns
           (conversation_session_id, turn_index, role, content)
         VALUES ($1, 0, 'assistant', $2)
         ON CONFLICT (conversation_session_id, turn_index) DO NOTHING`,
        [conversationSessionId, content],
      )
      await client.query(
        `UPDATE skill_trainer.conversation_sessions SET turn_count = GREATEST(turn_count, 1) WHERE id = $1`,
        [conversationSessionId],
      )
      const reloaded = await client.query(
        `SELECT content FROM skill_trainer.conversation_turns WHERE conversation_session_id = $1 AND turn_index = 0`,
        [conversationSessionId],
      )
      return reloaded.rows[0].content
    })
  }
  return envelope(true, replayed ? "idempotent_replay" : "ok", {
    conversationSessionId,
    sessionId,
    scenario: storedScenario,
    assistantTurnIndex: 0,
    assistantMessage: opening,
    apiVersion: "adaptive-talk-v2",
    ...availability(context),
  }, null)
}

function classificationFrom(dimensions) {
  return dimensions?.session_metrics ?? { ...NO_METRICS }
}

async function findTurn(db, turnId) {
  const prior = await db.query(
    `SELECT t.id AS turn_id, t.conversation_session_id, t.turn_index, t.content,
            t.latency_ms, reply.content AS assistant_message,
            go.grading_id, go.status AS grading_status, go.dimension_results AS dimensions
     FROM skill_trainer.conversation_turns t
     LEFT JOIN skill_trainer.conversation_turns reply
       ON reply.conversation_session_id = t.conversation_session_id
      AND reply.turn_index = t.turn_index + 1 AND reply.role = 'assistant'
     LEFT JOIN skill_trainer.grading_observations go ON go.conversation_turn_id = t.id
     WHERE t.client_turn_id = $1`,
    [turnId],
  )
  return prior.rows[0] ?? null
}

async function replayTurn(context, db, existing, request) {
  if (
    Number(existing.conversation_session_id) !== request.sessionId
    || existing.content !== request.message
    || (existing.latency_ms ?? null) !== request.latency
  ) {
    return envelope(false, "idempotency_conflict", {}, { message: "turn_id was already used with different immutable input" })
  }
  const evidence = existing.grading_id
    ? await db.query(
      `SELECT ce.evidence_id, sc.stable_key FROM skill_trainer.capability_evidence ce
       JOIN skill_trainer.skill_concepts sc ON sc.id = ce.skill_id
       WHERE ce.grading_id = $1 ORDER BY sc.stable_key`,
      [existing.grading_id],
    )
    : { rows: [] }
  return envelope(true, "idempotent_replay", {
    conversationSessionId: request.sessionId,
    conversationTurnId: Number(existing.turn_id),
    turnId: request.turnId,
    userTurnIndex: existing.turn_index,
    assistantTurnIndex: existing.turn_index + 1,
    assistantMessage: existing.assistant_message,
    gradingId: existing.grading_id,
    gradingStatus: existing.grading_status,
    classification: existing.dimensions ? classificationFrom(existing.dimensions) : null,
    attributedSkillKeys: evidence.rows.map((row) => row.stable_key),
    evidenceIds: [...evidence.rows.map((row) => row.evidence_id)].sort(),
    ...availability(context),
  }, null)
}

async function loadSession(db, sessionId, lock) {
  const session = await db.query(
    `SELECT cs.scenario, cs.ended_at, cs.turn_count, d.code
     FROM skill_trainer.conversation_sessions cs
     JOIN skill_trainer.domains d ON d.id = cs.domain_id
     WHERE cs.id = $1 ${lock ? "FOR UPDATE OF cs" : ""}`,
    [sessionId],
  )
  return session.rows[0] ?? null
}

async function matchedSkills(db, domainCode, message) {
  const normalizedMessage = normalizeAnswer(message)
  const references = await db.query(
    `SELECT DISTINCT sc.id, sc.stable_key, reference.value AS reference
     FROM skill_trainer.skill_concepts sc
     JOIN skill_trainer.exercise_definitions ed ON ed.target_skill_id = sc.id
     CROSS JOIN LATERAL jsonb_array_elements_text(ed.reference_examples) reference(value)
     WHERE sc.status = 'active' AND ed.status = 'active'
       AND sc.domain_id = (SELECT id FROM skill_trainer.domains WHERE code = $1)
     ORDER BY sc.stable_key`,
    [domainCode],
  )
  const matched = new Map()
  for (const reference of references.rows) {
    if (matched.has(reference.stable_key) || normalizeAnswer(reference.reference) !== normalizedMessage) continue
    matched.set(reference.stable_key, { id: reference.id, stable_key: reference.stable_key })
  }
  return [...matched.values()]
}

export async function sendTalkMessage(context, request) {
  const turn = {
    sessionId: request.conversation_session_id,
    turnId: request.turn_id.trim().toLowerCase(),
    message: request.message.trim(),
    latency: Number.isInteger(request.latency_ms) ? request.latency_ms : null,
  }
  const existing = await findTurn({ query }, turn.turnId)
  if (existing) return replayTurn(context, { query }, existing, turn)
  const session = await loadSession({ query }, turn.sessionId, false)
  if (!session) return envelope(false, "not_found", {}, { message: "session not found" })
  if (session.ended_at) return envelope(false, "session_ended", {}, { message: "this talk session has already ended" })
  const history = await query(
    `SELECT role, content FROM skill_trainer.conversation_turns
     WHERE conversation_session_id = $1 ORDER BY turn_index`,
    [turn.sessionId],
  )

  let reply
  let status
  let classification
  try {
    const judged = await judgeTurn(context, session.scenario, history.rows, turn.message)
    reply = judged.reply
    status = "graded"
    classification = {
      selfQuestion: judged.selfQuestion,
      followUp: judged.followUp,
      errorHandling: judged.errorHandling,
      freeze: judged.freeze,
      japaneseFallback: judged.japaneseFallback,
    }
  } catch (error) {
    console.warn("adaptive talk observer unavailable", turn.sessionId, error.message)
    reply = TURN_FALLBACK
    status = "ungraded"
    classification = { ...NO_METRICS }
  }
  const matched = await matchedSkills({ query }, session.code, turn.message)
  const policyVersion = (await loadPolicy()).version

  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [turn.sessionId])
    const raced = await findTurn(client, turn.turnId)
    if (raced) return replayTurn(context, client, raced, turn)
    const locked = await loadSession(client, turn.sessionId, true)
    if (locked.ended_at) return envelope(false, "session_ended", {}, { message: "this talk session has already ended" })
    const userTurnIndex = locked.turn_count
    const userTurn = await client.query(
      `INSERT INTO skill_trainer.conversation_turns
         (conversation_session_id, turn_index, role, content, latency_ms, client_turn_id)
       VALUES ($1, $2, 'user', $3, $4, $5) RETURNING id`,
      [turn.sessionId, userTurnIndex, turn.message, turn.latency, turn.turnId],
    )
    const conversationTurnId = Number(userTurn.rows[0].id)
    await client.query(
      `INSERT INTO skill_trainer.conversation_turns
         (conversation_session_id, turn_index, role, content)
       VALUES ($1, $2, 'assistant', $3)`,
      [turn.sessionId, userTurnIndex + 1, reply],
    )
    const dimensions = {
      communication: classification.freeze ? "fail" : "pass",
      semantic: "not_observed",
      intent: status === "graded" ? "pass" : "not_observed",
      form: "not_observed",
      policy: classification.japaneseFallback ? "fail" : "pass",
      target_skill_usage: matched.length ? "pass" : "not_observed",
      session_metrics: classification,
    }
    const gradingId = randomUUID()
    const adopted = status === "graded" && matched.length > 0
    await client.query(
      `INSERT INTO skill_trainer.grading_observations
         (grading_id, learner_key, conversation_turn_id, source, observer_version, idempotency_key,
          status, adopted_for_evidence, rubric_version, dimension_results, reason,
          skill_candidates, error_candidates, model_reported_confidence)
       VALUES ($1, $2, $3, 'ai', $4, $5, $6, $7, 'conversation-turn-v2', $8, $9, $10,
               '[]'::jsonb, NULL)`,
      [
        gradingId,
        context.learnerKey,
        conversationTurnId,
        OBSERVER,
        hashParts(["talk-turn", turn.turnId]),
        status,
        adopted,
        JSON.stringify(dimensions),
        status === "graded"
          ? "AI session observation; per-Skill Evidence only for deterministic reference match"
          : "talk observer unavailable",
        JSON.stringify(matched.map((item) => item.stable_key)),
      ],
    )
    const evidenceIds = []
    if (adopted) {
      for (const skill of matched) {
        const evidenceId = randomUUID()
        await client.query(
          `INSERT INTO skill_trainer.capability_evidence
             (evidence_id, learner_key, conversation_turn_id, grading_id, skill_id, capability,
              modality, outcome, latency_ms, error_cause, evidence_confidence,
              derivation_version, policy_version, observed_at)
           VALUES ($1, $2, $3, $4, $5, 'CONVERSATION_USAGE', 'conversation', 'success',
                   $6, NULL, 90, $7, $8, NOW())`,
          [evidenceId, context.learnerKey, conversationTurnId, gradingId, skill.id, turn.latency, DERIVATION, policyVersion],
        )
        evidenceIds.push(evidenceId)
      }
    }
    await client.query(
      `UPDATE skill_trainer.conversation_sessions
       SET turn_count = turn_count + 2, metrics_version = $2 WHERE id = $1`,
      [turn.sessionId, METRICS],
    )
    return envelope(true, "ok", {
      conversationSessionId: turn.sessionId,
      conversationTurnId,
      turnId: turn.turnId,
      userTurnIndex,
      assistantTurnIndex: userTurnIndex + 1,
      assistantMessage: reply,
      gradingId,
      gradingStatus: status,
      classification: classificationFrom(dimensions),
      attributedSkillKeys: matched.map((item) => item.stable_key),
      evidenceIds,
      ...availability(context),
    }, null)
  })
}

async function upsertCandidate(client, candidate, sourceContext) {
  if (!CATEGORIES.includes(candidate.category)) {
    console.warn("adaptive candidate has unsupported category", candidate.category)
    return false
  }
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('skill-trainer:candidate:' || lower($1), 0))",
    [candidate.pattern],
  )
  const found = candidate.existingCandidateId != null
    ? await client.query(
      `SELECT id, need_count, status FROM skill_trainer.candidate_skills WHERE id = $1`,
      [candidate.existingCandidateId],
    )
    : await client.query(
      `SELECT id, need_count, status FROM skill_trainer.candidate_skills
       WHERE lower(pattern) = lower($1) ORDER BY id LIMIT 1`,
      [candidate.pattern],
    )
  const existing = found.rows[0]
  if (existing?.status === "candidate") {
    await client.query(
      `UPDATE skill_trainer.candidate_skills
       SET need_count = $2, last_seen_at = NOW(), meaning = $3, source_context = $4
       WHERE id = $1`,
      [existing.id, Number(existing.need_count) + 1, candidate.meaning, sourceContext],
    )
    return true
  }
  if (existing) return false
  await client.query(
    `INSERT INTO skill_trainer.candidate_skills
       (pattern, meaning, source_context, need_count, first_seen_at, last_seen_at, status)
     VALUES ($1, $2, $3, 1, NOW(), NOW(), 'candidate')`,
    [candidate.pattern, candidate.meaning, sourceContext],
  )
  return true
}

async function frozenScenes(db, sessionId) {
  const contexts = await db.query(
    `SELECT t.content, previous.content AS previous
     FROM skill_trainer.conversation_turns t
     JOIN skill_trainer.grading_observations go ON go.conversation_turn_id = t.id
     LEFT JOIN skill_trainer.conversation_turns previous
       ON previous.conversation_session_id = t.conversation_session_id
      AND previous.turn_index = t.turn_index - 1
     WHERE t.conversation_session_id = $1 AND t.role = 'user'
       AND go.dimension_results->'session_metrics'->>'freeze' = 'true'
     ORDER BY t.turn_index`,
    [sessionId],
  )
  return contexts.rows
}

export async function endTalkSession(context, request) {
  const sessionId = request.conversation_session_id
  const ended = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [sessionId])
    const session = await client.query(
      `SELECT cs.scenario, cs.turn_count, cs.started_at, cs.ended_at, cs.candidate_extracted_at,
              cs.candidate_extraction_count
       FROM skill_trainer.conversation_sessions cs
       WHERE cs.id = $1 FOR UPDATE OF cs`,
      [sessionId],
    )
    const row = session.rows[0]
    if (!row) return null
    const metrics = await client.query(
      `SELECT
         count(*) FILTER (WHERE go.dimension_results->'session_metrics'->>'selfQuestion' = 'true')::int AS self_question,
         count(*) FILTER (WHERE go.dimension_results->'session_metrics'->>'followUp' = 'true')::int AS follow_up,
         count(*) FILTER (WHERE go.dimension_results->'session_metrics'->>'errorHandling' = 'true')::int AS error_handling,
         count(*) FILTER (WHERE go.dimension_results->'session_metrics'->>'freeze' = 'true')::int AS freeze,
         count(*) FILTER (WHERE go.dimension_results->'session_metrics'->>'japaneseFallback' = 'true')::int AS japanese,
         round(avg(t.latency_ms))::int AS latency
       FROM skill_trainer.conversation_turns t
       LEFT JOIN skill_trainer.grading_observations go ON go.conversation_turn_id = t.id
       WHERE t.conversation_session_id = $1 AND t.role = 'user'`,
      [sessionId],
    )
    const counts = metrics.rows[0]
    const updated = await client.query(
      `UPDATE skill_trainer.conversation_sessions
       SET ended_at = COALESCE(ended_at, NOW()), self_question_count = $2,
           follow_up_count = $3, error_handling_count = $4, freeze_count = $5,
           japanese_fallback_count = $6, avg_latency_ms = $7, metrics_version = $8
       WHERE id = $1
       RETURNING ended_at`,
      [sessionId, counts.self_question, counts.follow_up, counts.error_handling, counts.freeze, counts.japanese, counts.latency, METRICS],
    )
    let scenes = []
    if (!row.candidate_extracted_at) {
      scenes = await frozenScenes(client, sessionId)
      if (!scenes.length) {
        await client.query(
          `UPDATE skill_trainer.conversation_sessions
           SET candidate_extracted_at = NOW(), candidate_extraction_count = 0 WHERE id = $1`,
          [sessionId],
        )
      }
    }
    return { row, counts, endedAt: updated.rows[0].ended_at, scenes }
  })
  if (!ended) return envelope(false, "not_found", {}, { message: "session not found" })
  const { row, counts, endedAt, scenes } = ended
  const sourceContext = `AdaptiveTalk(${row.scenario})session=${sessionId}`
  let candidateCount = row.candidate_extracted_at ? Number(row.candidate_extraction_count) : 0
  let extractionStatus = "completed"
  if (scenes.length) {
    const existing = await query(
      `SELECT id, pattern, coalesce(meaning, '') AS meaning
       FROM skill_trainer.candidate_skills WHERE status = 'candidate'`,
    )
    let candidates = null
    try {
      candidates = await extractCandidates(context, row.scenario, scenes, existing.rows)
    } catch (error) {
      console.warn("adaptive candidate extraction unavailable", sessionId, error.message)
      extractionStatus = "pending_retry"
    }
    if (candidates) {
      const stored = await withTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock($1)", [sessionId])
        const current = await client.query(
          `SELECT candidate_extracted_at, candidate_extraction_count
           FROM skill_trainer.conversation_sessions WHERE id = $1 FOR UPDATE`,
          [sessionId],
        )
        if (current.rows[0].candidate_extracted_at) return Number(current.rows[0].candidate_extraction_count)
        let count = 0
        for (const candidate of candidates) {
          if (await upsertCandidate(client, candidate, sourceContext)) count += 1
        }
        await client.query(
          `UPDATE skill_trainer.conversation_sessions
           SET candidate_extracted_at = NOW(), candidate_extraction_count = $2
           WHERE id = $1`,
          [sessionId, count],
        )
        return count
      })
      candidateCount = stored
      extractionStatus = "completed"
    }
  }
  const replayed = Boolean(row.ended_at) && Boolean(row.candidate_extracted_at)
  const open = await query(
    `SELECT id, pattern, meaning FROM skill_trainer.candidate_skills
     WHERE status = 'candidate' AND source_context = $1 ORDER BY id`,
    [sourceContext],
  )
  return envelope(true, replayed ? "idempotent_replay" : "ok", {
    conversationSessionId: sessionId,
    scenario: row.scenario,
    turnCount: row.turn_count,
    selfQuestionCount: counts.self_question,
    followUpCount: counts.follow_up,
    errorHandlingCount: counts.error_handling,
    freezeCount: counts.freeze,
    japaneseFallbackCount: counts.japanese,
    avgLatencyMs: counts.latency,
    durationSeconds: Math.trunc((new Date(endedAt) - new Date(row.started_at)) / 1000),
    newCandidateCount: candidateCount,
    candidateExtractionStatus: extractionStatus,
    promotedSkills: [],
    metricsVersion: METRICS,
    candidates: open.rows.map((candidate) => ({
      candidateId: Number(candidate.id),
      pattern: candidate.pattern,
      meaning: candidate.meaning,
    })),
  }, null)
}
