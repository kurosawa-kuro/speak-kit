import { randomUUID } from "node:crypto"
import { askClaude } from "./ai/client.mjs"
import { aiAvailability } from "./ai/isEnabled.mjs"
import { normalizeAnswer } from "./ai/grade.mjs"
import { envelope } from "./envelope.mjs"
import { hashParts } from "./hash.mjs"
import { query, withTransaction } from "./db.mjs"
import { DERIVATION, loadPolicy } from "./learning.mjs"

const OBSERVER = "phase1-talk-ai-v2"
const METRICS = "phase1-talk-metrics-v2"

const PERSONA = {
  teacher: "あなたは英語教師(Teacher)です。学習者はPhase 1の英会話基礎（自己紹介・質問・時間表現・依頼・聞き返し）を練習しています。簡単で明確な英語を使い、学習者が詰まったら優しく助け舟を出し、自然に質問を返して会話を続けさせてください。返答は1〜3文の短い英語にしてください。",
  learner: "あなたは学習者と同じくらいの英語レベルの学習者(Learner)として、対等な立場でカジュアルだが礼儀正しい雑談をしてください。自然に質問を返し、会話を続けてください。返答は1〜3文の短い英語にしてください。",
  free_talk: "あなたは自然な会話パートナー(Free Talk)として、ネイティブらしい自然さで会話してください。話題は自由です。学習者が英語で詰まったら、優しく言い換えや簡単な表現で助けてください。返答は1〜3文の短い英語にしてください。",
}
const OPENING_USER = "次のJSONスキーマだけで返答してください。\n{\"reply\": \"会話を始める最初の英語の発言(1〜2文)\"}"
const OPENING_FALLBACK = "Hi! Let's practice some English together. How are you today?"
const TURN_FALLBACK = "Sorry, could you say that again?"
const CANDIDATE_EXTRACTION_SYSTEM = "あなたは英会話学習アプリの分析者です。学習者が会話中に英語で言いたかったが言えずに完全に停止した場面がいくつかあります。各場面の直前のAIの発言と学習者の発言（短い・あいまい・日本語混在の場合あり）から、学習者が本当に言いたかった英語の表現（再利用可能な型でよい。1文）と、その日本語の意味、該当するカテゴリ（OUTPUT/QUERY/TIME/ACTION/ERROR_HANDLINGのいずれか1つ）を推測してください。複数の場面が同じ内容を指している場合は1件にまとめてください。推測できない場面は無視してください。\n\n既存の未昇格候補一覧が渡された場合、今回推測した各候補が既存のどれかと同じ需要（言い回しが違っても意味・用途が同じ）かどうかを判定し、同じなら`existingCandidateId`にその既存候補のidを入れてください（新しいpattern/meaningの文字列が完全一致しなくても構いません）。新規の需要なら`existingCandidateId`はnullにしてください。JSON以外は一切出力しないでください。"
const CATEGORIES = ["OUTPUT", "QUERY", "TIME", "ACTION", "ERROR_HANDLING"]
const NO_METRICS = { selfQuestion: false, followUp: false, errorHandling: false, freeze: false, japaneseFallback: false }

function turnSystem(persona) {
  return `${persona}

加えて、学習者の直前の発言を次の観点で判定し、JSONに含めてください。
- selfQuestion: 学習者が自発的に質問をしたか
- followUp: 学習者が直前のあなたの発言に対する自然なフォローアップをしたか
- errorHandling: 学習者が聞き返し・確認・言い換え依頼などのERROR HANDLING表現を使ったか（例: Could you repeat that? / What does X mean? / Sorry, I don't understand）
- freeze: 学習者が英語で続けられず完全に停止した、または『わからない』と投げたか
- japaneseFallback: 学習者の発言に日本語が含まれていたか
JSON以外は一切出力しないでください。`
}

function turnUser(historyText, message) {
  return `これまでの会話:
${historyText}

学習者の最新の発言: ${message}

次のJSONスキーマだけで返答してください。
{"reply": "あなたの次の英語の発言(1〜3文)", "selfQuestion": true または false, "followUp": true または false, "errorHandling": true または false, "freeze": true または false, "japaneseFallback": true または false}`
}

function candidateUser(scenario, scenes, existingList) {
  return `シナリオ: ${scenario}

${scenes}

既存の未昇格候補一覧:
${existingList}

次のJSONスキーマだけで返答してください。
{"candidates": [{"pattern": "英語の型(1文)", "meaning": "日本語の意味", "category": "OUTPUT/QUERY/TIME/ACTION/ERROR_HANDLINGのいずれか", "existingCandidateId": 既存候補のid(整数)またはnull}]}`
}

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

async function askJudge(system, user, maxTokens) {
  const asked = await askClaude(system, user, { maxTokens, timeoutMs: 45000 })
  if (!asked.ok) throw new Error(asked.error?.message || asked.code)
  return jsonObject(asked.data.text)
}

async function generateOpening(scenario) {
  const parsed = await askJudge(
    `${PERSONA[scenario]}\nこれは会話の最初のターンです。自然な一言で会話を始めてください。`,
    OPENING_USER,
    150,
  )
  if (typeof parsed.reply !== "string") throw new Error("parse ai judge json")
  return parsed.reply
}

async function judgeTurn(scenario, history, message) {
  const historyText = history
    .slice(-10)
    .map((row) => `${row.role === "assistant" ? "AI" : "User"}: ${row.content}`)
    .join("\n")
  const parsed = await askJudge(turnSystem(PERSONA[scenario]), turnUser(historyText, message), 300)
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

async function extractCandidates(scenario, contexts, existing) {
  const scenes = contexts
    .map((row, index) => `場面${index + 1}:\nAI: ${row.previous ?? "(会話の最初のターン)"}\n学習者: ${row.content}`)
    .join("\n\n")
  const existingList = existing.length
    ? existing.map((row) => `id=${row.id}: ${row.pattern} (${row.meaning})`).join("\n")
    : "(なし)"
  const parsed = await askJudge(CANDIDATE_EXTRACTION_SYSTEM, candidateUser(scenario, scenes, existingList), 700)
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

export async function startTalkSession(request, domainId) {
  const scenario = request.scenario.trim()
  const sessionId = request.session_id.trim()
  const inserted = await query(
    `INSERT INTO skill_trainer.conversation_sessions
       (scenario, session_id, metrics_version, domain_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id) DO NOTHING
     RETURNING id`,
    [scenario, sessionId, METRICS, domainId],
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
      content = await generateOpening(storedScenario)
    } catch (error) {
      console.warn("adaptive talk opening unavailable", conversationSessionId, error.message)
      content = OPENING_FALLBACK
    }
    await query(
      `INSERT INTO skill_trainer.conversation_turns
         (conversation_session_id, turn_index, role, content)
       VALUES ($1, 0, 'assistant', $2)
       ON CONFLICT (conversation_session_id, turn_index) DO NOTHING`,
      [conversationSessionId, content],
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
  return envelope(true, replayed ? "idempotent_replay" : "ok", {
    conversationSessionId,
    sessionId,
    scenario: storedScenario,
    assistantTurnIndex: 0,
    assistantMessage: opening,
    apiVersion: "adaptive-talk-v2",
    ...(await aiAvailability()),
  }, null)
}

function classificationFrom(dimensions) {
  return dimensions?.session_metrics ?? { ...NO_METRICS }
}

export async function sendTalkMessage(request) {
  const sessionId = request.conversation_session_id
  const turnId = request.turn_id.trim().toLowerCase()
  const message = request.message.trim()
  const latency = Number.isInteger(request.latency_ms) ? request.latency_ms : null
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [sessionId])
    const prior = await client.query(
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
    const existing = prior.rows[0]
    if (existing) {
      if (Number(existing.conversation_session_id) !== sessionId || existing.content !== message || (existing.latency_ms ?? null) !== latency) {
        return envelope(false, "idempotency_conflict", {}, { message: "turn_id was already used with different immutable input" })
      }
      const skills = existing.grading_id
        ? await client.query(
          `SELECT sc.stable_key FROM skill_trainer.capability_evidence ce
           JOIN skill_trainer.skill_concepts sc ON sc.id = ce.skill_id
           WHERE ce.grading_id = $1 ORDER BY sc.stable_key`,
          [existing.grading_id],
        )
        : { rows: [] }
      const evidence = existing.grading_id
        ? await client.query(
          `SELECT evidence_id FROM skill_trainer.capability_evidence WHERE grading_id = $1 ORDER BY evidence_id`,
          [existing.grading_id],
        )
        : { rows: [] }
      return envelope(true, "idempotent_replay", {
        conversationSessionId: sessionId,
        conversationTurnId: Number(existing.turn_id),
        turnId,
        userTurnIndex: existing.turn_index,
        assistantTurnIndex: existing.turn_index + 1,
        assistantMessage: existing.assistant_message,
        gradingId: existing.grading_id,
        gradingStatus: existing.grading_status,
        classification: existing.dimensions ? classificationFrom(existing.dimensions) : null,
        attributedSkillKeys: skills.rows.map((row) => row.stable_key),
        evidenceIds: evidence.rows.map((row) => row.evidence_id),
        ...(await aiAvailability()),
      }, null)
    }
    const session = await client.query(
      `SELECT cs.scenario, cs.ended_at, cs.turn_count, d.code
       FROM skill_trainer.conversation_sessions cs
       JOIN skill_trainer.domains d ON d.id = cs.domain_id
       WHERE cs.id = $1 FOR UPDATE OF cs`,
      [sessionId],
    )
    const row = session.rows[0]
    if (!row) return envelope(false, "not_found", {}, { message: "session not found" })
    if (row.ended_at) return envelope(false, "session_ended", {}, { message: "this talk session has already ended" })
    const history = await client.query(
      `SELECT role, content FROM skill_trainer.conversation_turns
       WHERE conversation_session_id = $1 ORDER BY turn_index`,
      [sessionId],
    )
    let reply
    let status
    let classification
    try {
      const judged = await judgeTurn(row.scenario, history.rows, message)
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
      console.warn("adaptive talk observer unavailable", sessionId, error.message)
      reply = TURN_FALLBACK
      status = "ungraded"
      classification = { ...NO_METRICS }
    }
    const userTurnIndex = row.turn_count
    const userTurn = await client.query(
      `INSERT INTO skill_trainer.conversation_turns
         (conversation_session_id, turn_index, role, content, latency_ms, client_turn_id)
       VALUES ($1, $2, 'user', $3, $4, $5) RETURNING id`,
      [sessionId, userTurnIndex, message, latency, turnId],
    )
    const conversationTurnId = Number(userTurn.rows[0].id)
    await client.query(
      `INSERT INTO skill_trainer.conversation_turns
         (conversation_session_id, turn_index, role, content)
       VALUES ($1, $2, 'assistant', $3)`,
      [sessionId, userTurnIndex + 1, reply],
    )
    const normalizedMessage = normalizeAnswer(message)
    const references = await client.query(
      `SELECT DISTINCT sc.id, sc.stable_key, reference.value AS reference
       FROM skill_trainer.skill_concepts sc
       JOIN skill_trainer.exercise_definitions ed ON ed.target_skill_id = sc.id
       CROSS JOIN LATERAL jsonb_array_elements_text(ed.reference_examples) reference(value)
       WHERE sc.status = 'active' AND ed.status = 'active'
         AND sc.domain_id = (SELECT id FROM skill_trainer.domains WHERE code = $1)
       ORDER BY sc.stable_key`,
      [row.code],
    )
    const matchedKeys = new Set()
    const matched = { rows: [] }
    for (const reference of references.rows) {
      if (matchedKeys.has(reference.stable_key) || normalizeAnswer(reference.reference) !== normalizedMessage) continue
      matchedKeys.add(reference.stable_key)
      matched.rows.push({ id: reference.id, stable_key: reference.stable_key })
    }
    const dimensions = {
      communication: classification.freeze ? "fail" : "pass",
      semantic: "not_observed",
      intent: status === "graded" ? "pass" : "not_observed",
      form: "not_observed",
      policy: classification.japaneseFallback ? "fail" : "pass",
      target_skill_usage: matched.rows.length ? "pass" : "not_observed",
      session_metrics: classification,
    }
    const gradingId = randomUUID()
    const adopted = status === "graded" && matched.rows.length > 0
    await client.query(
      `INSERT INTO skill_trainer.grading_observations
         (grading_id, conversation_turn_id, source, observer_version, idempotency_key,
          status, adopted_for_evidence, rubric_version, dimension_results, reason,
          skill_candidates, error_candidates, model_reported_confidence)
       VALUES ($1, $2, 'ai', $3, $4, $5, $6, 'conversation-turn-v2', $7, $8, $9,
               '[]'::jsonb, NULL)`,
      [
        gradingId,
        conversationTurnId,
        OBSERVER,
        hashParts(["talk-turn", turnId]),
        status,
        adopted,
        JSON.stringify(dimensions),
        status === "graded"
          ? "AI session observation; per-Skill Evidence only for deterministic reference match"
          : "talk observer unavailable",
        JSON.stringify(matched.rows.map((item) => item.stable_key)),
      ],
    )
    const policyVersion = (await loadPolicy()).version
    const evidenceIds = []
    if (adopted) {
      for (const skill of matched.rows) {
        const evidenceId = randomUUID()
        await client.query(
          `INSERT INTO skill_trainer.capability_evidence
             (evidence_id, conversation_turn_id, grading_id, skill_id, capability,
              modality, outcome, latency_ms, error_cause, evidence_confidence,
              derivation_version, policy_version, observed_at)
           VALUES ($1, $2, $3, $4, 'CONVERSATION_USAGE', 'conversation', 'success',
                   $5, NULL, 90, $6, $7, NOW())`,
          [evidenceId, conversationTurnId, gradingId, skill.id, latency, DERIVATION, policyVersion],
        )
        evidenceIds.push(evidenceId)
      }
    }
    await client.query(
      `UPDATE skill_trainer.conversation_sessions
       SET turn_count = turn_count + 2, metrics_version = $2 WHERE id = $1`,
      [sessionId, METRICS],
    )
    return envelope(true, "ok", {
      conversationSessionId: sessionId,
      conversationTurnId,
      turnId,
      userTurnIndex,
      assistantTurnIndex: userTurnIndex + 1,
      assistantMessage: reply,
      gradingId,
      gradingStatus: status,
      classification: classificationFrom(dimensions),
      attributedSkillKeys: matched.rows.map((item) => item.stable_key),
      evidenceIds,
      ...(await aiAvailability()),
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

export async function endTalkSession(request) {
  const sessionId = request.conversation_session_id
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [sessionId])
    const session = await client.query(
      `SELECT cs.scenario, cs.turn_count, cs.started_at, cs.ended_at, cs.candidate_extracted_at,
              cs.candidate_extraction_count, d.code
       FROM skill_trainer.conversation_sessions cs
       JOIN skill_trainer.domains d ON d.id = cs.domain_id
       WHERE cs.id = $1 FOR UPDATE OF cs`,
      [sessionId],
    )
    const row = session.rows[0]
    if (!row) return envelope(false, "not_found", {}, { message: "session not found" })
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
    const ended = await client.query(
      `UPDATE skill_trainer.conversation_sessions
       SET ended_at = COALESCE(ended_at, NOW()), self_question_count = $2,
           follow_up_count = $3, error_handling_count = $4, freeze_count = $5,
           japanese_fallback_count = $6, avg_latency_ms = $7, metrics_version = $8
       WHERE id = $1
       RETURNING ended_at`,
      [sessionId, counts.self_question, counts.follow_up, counts.error_handling, counts.freeze, counts.japanese, counts.latency, METRICS],
    )
    const endedAt = ended.rows[0].ended_at
    let candidateCount = Number(row.candidate_extraction_count)
    let extractionStatus = row.candidate_extracted_at ? "completed" : "not_needed"
    if (!row.candidate_extracted_at) {
      const contexts = await client.query(
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
      if (contexts.rows.length) {
        const existing = await client.query(
          `SELECT id, pattern, coalesce(meaning, '') AS meaning
           FROM skill_trainer.candidate_skills WHERE status = 'candidate'`,
        )
        let candidates = null
        try {
          candidates = await extractCandidates(row.scenario, contexts.rows, existing.rows)
        } catch (error) {
          console.warn("adaptive candidate extraction unavailable", sessionId, error.message)
          extractionStatus = "pending_retry"
        }
        if (candidates) {
          candidateCount = 0
          for (const candidate of candidates) {
            if (await upsertCandidate(client, candidate, `AdaptiveTalk(${row.scenario})session=${sessionId}`)) {
              candidateCount += 1
            }
          }
          await client.query(
            `UPDATE skill_trainer.conversation_sessions
             SET candidate_extracted_at = NOW(), candidate_extraction_count = $2
             WHERE id = $1`,
            [sessionId, candidateCount],
          )
          extractionStatus = "completed"
        }
      } else {
        await client.query(
          `UPDATE skill_trainer.conversation_sessions
           SET candidate_extracted_at = NOW(), candidate_extraction_count = 0 WHERE id = $1`,
          [sessionId],
        )
        candidateCount = 0
        extractionStatus = "completed"
      }
    }
    const replayed = Boolean(row.ended_at) && Boolean(row.candidate_extracted_at)
    const open = await client.query(
      `SELECT id, pattern, meaning FROM skill_trainer.candidate_skills
       WHERE status = 'candidate' AND source_context = $1 ORDER BY id`,
      [`AdaptiveTalk(${row.scenario})session=${sessionId}`],
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
  })
}
