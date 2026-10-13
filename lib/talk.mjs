import { randomUUID } from "node:crypto"
import { askClaude } from "./ai/client.mjs"
import { aiEnabled } from "./ai/isEnabled.mjs"
import { envelope } from "./envelope.mjs"
import { hashParts } from "./hash.mjs"
import { query } from "./db.mjs"

const METRICS = "phase1-talk-metrics-v2"
const OPENING = "Hi! Let's practice some English together. How are you today?"
const TURN_FALLBACK = "Sorry, could you say that again?"
const PERSONA = {
  teacher: "あなたは英語教師(Teacher)です。学習者はPhase 1の英会話基礎を練習しています。簡単で明確な英語を使い、返答は1〜3文にしてください。",
  learner: "あなたは学習者と同じくらいの英語レベルの学習者として、対等に雑談してください。返答は1〜3文にしてください。",
  free_talk: "あなたは自然な会話パートナーとして会話してください。返答は1〜3文にしてください。",
}

function flagsFromText(message, first) {
  return {
    selfQuestion: message.includes("?"),
    followUp: !first && message.trim().length > 8,
    errorHandling: /\b(sorry|repeat|mean|understand|again)\b/i.test(message),
    freeze: /わからない|分からない/.test(message) || message.trim().length < 2,
    japaneseFallback: /[\u3040-\u30ff\u3400-\u9fff]/.test(message),
  }
}

function parseTalk(text) {
  if (!text) return null
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

async function judgeTurn(scenario, history, message, first) {
  if (!aiEnabled()) return { reply: TURN_FALLBACK, ...flagsFromText(message, first), ai: false }
  const persona = PERSONA[scenario] || PERSONA.teacher
  const asked = await askClaude(
    `${persona}\n\n加えて、学習者の直前の発言を selfQuestion, followUp, errorHandling, freeze, japaneseFallback で判定し、JSON以外は出力しないでください。`,
    `これまでの会話:\n${history}\n\n学習者の最新の発言: ${message}\n\n{"reply":"","selfQuestion":false,"followUp":false,"errorHandling":false,"freeze":false,"japaneseFallback":false}`,
    { maxTokens: 600, timeoutMs: 20000 },
  )
  const parsed = asked.ok ? parseTalk(asked.data.text) : null
  if (!parsed?.reply) return { reply: TURN_FALLBACK, ...flagsFromText(message, first), ai: false }
  return {
    reply: String(parsed.reply),
    selfQuestion: parsed.selfQuestion === true,
    followUp: parsed.followUp === true,
    errorHandling: parsed.errorHandling === true,
    freeze: parsed.freeze === true,
    japaneseFallback: parsed.japaneseFallback === true,
    ai: true,
  }
}

export async function startTalkSession(request, domainId) {
  const scenario = request.scenario
  const sessionId = request.session_id
  const inserted = await query(
    `INSERT INTO skill_trainer.conversation_sessions
       (scenario, session_id, metrics_version, domain_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id) DO NOTHING
     RETURNING id`,
    [scenario, sessionId, METRICS, domainId],
  )
  let conversationSessionId = inserted.rows[0]?.id
  let replayed = false
  if (!conversationSessionId) {
    const stored = await query(
      `SELECT id, scenario, domain_id FROM skill_trainer.conversation_sessions WHERE session_id = $1`,
      [sessionId],
    )
    const row = stored.rows[0]
    if (!row || row.scenario !== scenario || String(row.domain_id) !== String(domainId)) {
      return envelope(false, "idempotency_conflict", {}, { message: "session_id was already used for another scenario or domain" })
    }
    conversationSessionId = row.id
    replayed = true
  }
  const existing = await query(
    `SELECT content FROM skill_trainer.conversation_turns
     WHERE conversation_session_id = $1 AND turn_index = 0 AND role = 'assistant'`,
    [conversationSessionId],
  )
  let opening = existing.rows[0]?.content
  if (!opening) {
    opening = OPENING
    if (aiEnabled()) {
      const asked = await askClaude(
        `${PERSONA[scenario] || PERSONA.teacher}\nこれは会話の最初のターンです。自然な一言で会話を始めてください。`,
        '次のJSONスキーマだけで返答してください。\n{"reply":"会話を始める最初の英語の発言(1〜2文)"}',
        { maxTokens: 300, timeoutMs: 20000 },
      )
      opening = parseTalk(asked.ok ? asked.data.text : "")?.reply || OPENING
    }
    await query(
      `INSERT INTO skill_trainer.conversation_turns
         (conversation_session_id, turn_index, role, content)
       VALUES ($1, 0, 'assistant', $2)
       ON CONFLICT (conversation_session_id, turn_index) DO NOTHING`,
      [conversationSessionId, opening],
    )
    await query(
      `UPDATE skill_trainer.conversation_sessions SET turn_count = GREATEST(turn_count, 1) WHERE id = $1`,
      [conversationSessionId],
    )
    const reloaded = await query(
      `SELECT content FROM skill_trainer.conversation_turns WHERE conversation_session_id = $1 AND turn_index = 0`,
      [conversationSessionId],
    )
    opening = reloaded.rows[0].content
  }
  return envelope(replayed ? true : true, replayed ? "idempotent_replay" : "ok", {
    conversationSessionId,
    sessionId,
    scenario,
    assistantTurnIndex: 0,
    assistantMessage: opening,
    apiVersion: "adaptive-talk-v2",
    aiAvailable: aiEnabled(),
  }, null)
}

export async function sendTalkMessage(request) {
  const sessionId = Number(request.conversation_session_id)
  const session = await query(
    `SELECT id, scenario FROM skill_trainer.conversation_sessions WHERE id = $1`,
    [sessionId],
  )
  if (!session.rows[0]) return envelope(false, "not_found", {}, { message: "session not found" })
  const prior = await query(
    `SELECT id FROM skill_trainer.conversation_turns WHERE client_turn_id = $1`,
    [request.turn_id],
  )
  if (prior.rows[0]) {
    return envelope(true, "idempotent_replay", { conversationSessionId: sessionId, turnId: request.turn_id }, null)
  }
  const last = await query(
    `SELECT coalesce(max(turn_index), -1)::int AS turn_index,
            count(*) FILTER (WHERE role = 'user')::int AS user_turns
     FROM skill_trainer.conversation_turns WHERE conversation_session_id = $1`,
    [sessionId],
  )
  const userIndex = Number(last.rows[0].turn_index) + 1
  const judged = await judgeTurn(session.rows[0].scenario, "", request.message, Number(last.rows[0].user_turns) === 0)
  const userTurn = await query(
    `INSERT INTO skill_trainer.conversation_turns
       (conversation_session_id, turn_index, role, content, latency_ms, client_turn_id,
        self_question, follow_up, error_handling, is_freeze, japanese_fallback)
     VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      sessionId, userIndex, request.message, Number.isInteger(request.latency_ms) ? request.latency_ms : null, request.turn_id,
      judged.selfQuestion, judged.followUp, judged.errorHandling, judged.freeze, judged.japaneseFallback,
    ],
  )
  await query(
    `INSERT INTO skill_trainer.grading_observations
       (grading_id, conversation_turn_id, source, observer_version, idempotency_key,
        status, adopted_for_evidence, rubric_version, dimension_results, reason)
     VALUES ($1, $2, $3, $4, $5, 'graded', false, 'talk-turn:1', $6, NULL)`,
    [
      randomUUID(),
      userTurn.rows[0].id,
      judged.ai ? "ai" : "deterministic",
      judged.ai ? "phase1-talk-ai-v1" : "phase1-talk-rules-v1",
      hashParts([request.turn_id, "talk"]),
      JSON.stringify({
        session_metrics: {
          selfQuestion: String(judged.selfQuestion),
          followUp: String(judged.followUp),
          errorHandling: String(judged.errorHandling),
          freeze: String(judged.freeze),
          japaneseFallback: String(judged.japaneseFallback),
        },
      }),
    ],
  )
  await query(
    `INSERT INTO skill_trainer.conversation_turns
       (conversation_session_id, turn_index, role, content)
     VALUES ($1, $2, 'assistant', $3)`,
    [sessionId, userIndex + 1, judged.reply],
  )
  await query(
    `UPDATE skill_trainer.conversation_sessions
     SET turn_count = GREATEST(turn_count, $2) WHERE id = $1`,
    [sessionId, userIndex + 2],
  )
  return envelope(true, "ok", {
    conversationSessionId: sessionId,
    assistantMessage: judged.reply,
    selfQuestion: judged.selfQuestion,
    followUp: judged.followUp,
    errorHandling: judged.errorHandling,
    freeze: judged.freeze,
    japaneseFallback: judged.japaneseFallback,
    aiAvailable: aiEnabled(),
  }, null)
}

export async function endTalkSession(request) {
  const sessionId = Number(request.conversation_session_id)
  const metrics = await query(
    `SELECT
       count(*) FILTER (WHERE go.dimension_results->'session_metrics'->>'selfQuestion' = 'true')::int AS self_question,
       count(*) FILTER (WHERE go.dimension_results->'session_metrics'->>'followUp' = 'true')::int AS follow_up,
       count(*) FILTER (WHERE go.dimension_results->'session_metrics'->>'errorHandling' = 'true')::int AS error_handling,
       count(*) FILTER (WHERE go.dimension_results->'session_metrics'->>'freeze' = 'true')::int AS freeze,
       count(*) FILTER (WHERE go.dimension_results->'session_metrics'->>'japaneseFallback' = 'true')::int AS japanese,
       round(avg(t.latency_ms))::int AS latency,
       count(t.id)::int AS turns
     FROM skill_trainer.conversation_turns t
     LEFT JOIN skill_trainer.grading_observations go ON go.conversation_turn_id = t.id
     WHERE t.conversation_session_id = $1 AND t.role = 'user'`,
    [sessionId],
  )
  const row = metrics.rows[0]
  if (!row || row.turns == null) return envelope(false, "not_found", {}, { message: "session not found" })
  const ended = await query(
    `UPDATE skill_trainer.conversation_sessions
     SET ended_at = COALESCE(ended_at, NOW()), self_question_count = $2,
         follow_up_count = $3, error_handling_count = $4, freeze_count = $5,
         japanese_fallback_count = $6, avg_latency_ms = $7, metrics_version = $8
     WHERE id = $1
     RETURNING turn_count, started_at, ended_at, candidate_extraction_count`,
    [sessionId, row.self_question, row.follow_up, row.error_handling, row.freeze, row.japanese, row.latency, METRICS],
  )
  if (!ended.rows[0]) return envelope(false, "not_found", {}, { message: "session not found" })
  const stored = ended.rows[0]
  const minutes = Math.max(0, Math.round((new Date(stored.ended_at) - new Date(stored.started_at)) / 60000))
  const candidates = await extractFreezeCandidates(sessionId)
  return envelope(true, "ok", {
    conversationSessionId: sessionId,
    turnCount: stored.turn_count,
    minutes,
    selfQuestionCount: row.self_question,
    followUpCount: row.follow_up,
    errorHandlingCount: row.error_handling,
    freezeCount: row.freeze,
    japaneseFallbackCount: row.japanese,
    avgLatencyMs: row.latency,
    newCandidateCount: candidates.length,
    candidates,
    metricsVersion: METRICS,
  }, null)
}

async function extractFreezeCandidates(sessionId) {
  const session = await query(
    `SELECT scenario, candidate_extracted_at FROM skill_trainer.conversation_sessions WHERE id = $1`,
    [sessionId],
  )
  if (!session.rows[0] || session.rows[0].candidate_extracted_at) {
    const existing = await query(
      `SELECT id, pattern, meaning FROM skill_trainer.candidate_skills
       WHERE status = 'candidate' AND source_context LIKE $1
       ORDER BY id`,
      [`%session=${sessionId}%`],
    )
    return existing.rows.map((row) => ({ candidateId: row.id, pattern: row.pattern, meaning: row.meaning }))
  }
  const freezes = await query(
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
  const created = []
  const scenes = freezes.rows.map((row) => `相手: ${row.previous || ""}\n学習者: ${row.content}`).join("\n")
  let parsed = []
  if (freezes.rows.length && aiEnabled()) {
    const asked = await askClaude(
      "会話で学習者が止まった場面から、まだ言えない英語の型だけを候補にする。JSON以外は出力しない。",
      `シナリオ: ${session.rows[0].scenario}\n\n${scenes}\n\n{"candidates":[{"pattern":"英語の型(1文)","meaning":"日本語の意味","category":"OUTPUT"}]}`,
      { maxTokens: 800, timeoutMs: 30000 },
    )
    const text = asked.ok ? asked.data.text : ""
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start >= 0 && end > start) {
      try {
        const body = JSON.parse(text.slice(start, end + 1))
        parsed = Array.isArray(body.candidates) ? body.candidates : []
      } catch {
        parsed = []
      }
    }
  }
  if (!parsed.length && freezes.rows.length) {
    parsed = freezes.rows.map((row) => ({
      pattern: row.content.slice(0, 240),
      meaning: "停止した場面",
      category: "OUTPUT",
    }))
  }
  for (const candidate of parsed) {
    const pattern = String(candidate.pattern || "").trim().slice(0, 255)
    const meaning = String(candidate.meaning || "").trim()
    const category = candidate.category
    if (!pattern || !["OUTPUT", "QUERY", "TIME", "ACTION", "ERROR_HANDLING"].includes(category)) continue
    const match = await query(
      `SELECT id, need_count, status FROM skill_trainer.candidate_skills
       WHERE lower(pattern) = lower($1) ORDER BY id LIMIT 1`,
      [pattern],
    )
    const source = `AdaptiveTalk(${session.rows[0].scenario})session=${sessionId}`
    if (match.rows[0]?.status === "candidate") {
      await query(
        `UPDATE skill_trainer.candidate_skills
         SET need_count = $2, last_seen_at = NOW(), meaning = $3, source_context = $4
         WHERE id = $1`,
        [match.rows[0].id, Number(match.rows[0].need_count) + 1, meaning, source],
      )
      created.push({ candidateId: match.rows[0].id, pattern, meaning })
    } else if (!match.rows[0]) {
      const inserted = await query(
        `INSERT INTO skill_trainer.candidate_skills
           (pattern, meaning, source_context, need_count, status)
         VALUES ($1, $2, $3, 1, 'candidate')
         RETURNING id`,
        [pattern, meaning, source],
      )
      created.push({ candidateId: inserted.rows[0].id, pattern, meaning })
    }
  }
  await query(
    `UPDATE skill_trainer.conversation_sessions
     SET candidate_extracted_at = NOW(), candidate_extraction_count = $2
     WHERE id = $1`,
    [sessionId, created.length],
  )
  return created
}
