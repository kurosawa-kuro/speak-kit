import { randomUUID } from "node:crypto"
import { verdictFields } from "../domain/verdict.mjs"
import { askClaude } from "../ai/client.mjs"
import { CONFUSION_DRAFT_SYSTEM, confusionDraftUser } from "../ai/prompts.mjs"
import { derivePair } from "../content/derive.mjs"
import { insertPairContent } from "../content/write.mjs"
import { envelope, validationError } from "../http/envelope.mjs"
import { query, withTransaction } from "../db.mjs"
import { folded, pairNotice } from "./boundary.mjs"

const DRAFT_FIELDS = [
  "key_a",
  "direction_a",
  "key_b",
  "direction_b",
  "probe_a1_prompt",
  "probe_a1_expected",
  "probe_b1_prompt",
  "probe_b1_expected",
  "probe_a2_prompt",
  "probe_a2_expected",
  "probe_b2_prompt",
  "probe_b2_expected",
]

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(DRAFT_FIELDS.map((key) => [key, { type: "string" }])),
  required: DRAFT_FIELDS,
}

function parseDraft(raw) {
  const trimmed = String(raw || "").trim()
    .replace(/^```json/, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim()
  try {
    const value = JSON.parse(trimmed)
    const draft = {}
    for (const key of DRAFT_FIELDS) {
      const field = typeof value[key] === "string" ? value[key].trim() : ""
      if (!field) return { error: `missing ${key}` }
      draft[key] = field
    }
    return { draft }
  } catch {
    return { error: "parse confusion discrimination draft" }
  }
}

async function discriminationDraft(operation, labelA, labelB) {
  const asked = await askClaude(operation, "confusion_draft", CONFUSION_DRAFT_SYSTEM, confusionDraftUser(labelA, labelB), {
    maxTokens: 800,
    timeoutMs: 45000,
    jsonSchema: DRAFT_SCHEMA,
  })
  if (!asked.ok) return { failure: asked }
  return parseDraft(asked.data.text)
}

function resetState(client, learnerKey, pairId) {
  return client.query(
    `INSERT INTO skill_trainer.learner_confusion_state AS st (learner_key, pair_id, pending_sides, next_due_at)
     VALUES ($1, $2, '["a","b"]'::jsonb, NOW())
     ON CONFLICT (learner_key, pair_id) DO UPDATE
       SET pending_sides = '["a","b"]'::jsonb, next_due_at = NOW(), serving_probe_id = NULL, updated_at = NOW()`,
    [learnerKey, pairId],
  )
}

/** AI の下書きを、YAML の混同ペアと同じ形にする。教材の導出は YAML と同じ derivePair を通す。 */
function pairEntry(rawA, rawB, draft) {
  const swap = rawA.toLowerCase() >= rawB.toLowerCase()
  const side = (raw, key, direction) => ({ label: raw, key, direction })
  const first = side(rawA, draft.key_a, draft.direction_a)
  const second = side(rawB, draft.key_b, draft.direction_b)
  const probe = (which, ordinal) => ({
    prompt: draft[`probe_${which}${ordinal}_prompt`],
    answer: draft[`probe_${which}${ordinal}_expected`],
  })
  const [aSide, bSide] = swap ? ["b", "a"] : ["a", "b"]
  return {
    type: "MEANING",
    source: "learner_registered",
    a: swap ? second : first,
    b: swap ? first : second,
    probes: [
      { side: "a", ...probe(aSide, 1) },
      { side: "b", ...probe(bSide, 1) },
      { side: "a", ...probe(aSide, 2) },
      { side: "b", ...probe(bSide, 2) },
    ],
  }
}

export async function registerPair(operation, request) {
  const rawA = request.label_a.trim()
  const rawB = request.label_b.trim()
  const keepOrder = rawA.toLowerCase() < rawB.toLowerCase()
  const labelA = keepOrder ? rawA : rawB
  const labelB = keepOrder ? rawB : rawA
  const findPair = (db) => db.query(
    "SELECT pair_id FROM skill_trainer.confusion_pairs WHERE label_a = $1 AND label_b = $2",
    [labelA, labelB],
  )
  const existing = (await findPair({ query })).rows[0]
  if (existing) {
    // 教材としてすでにあるペアは書き換えず、学習の状態だけを最初からにする。
    await withTransaction((client) => resetState(client, operation.learnerKey, existing.pair_id))
    return envelope(true, "ok", await pairNotice(existing.pair_id), null)
  }
  const { draft, failure, error } = await discriminationDraft(operation, rawA, rawB)
  if (failure) return { ...failure, error: { message: failure.error?.message || failure.code } }
  if (!draft) return envelope(false, "confusion_key_unavailable", {}, { message: error })
  const derived = derivePair(pairEntry(rawA, rawB, draft))
  const pairId = await withTransaction(async (client) => {
    await insertPairContent(client, derived)
    const stored = (await findPair(client)).rows[0]
    await resetState(client, operation.learnerKey, stored.pair_id)
    return stored.pair_id
  })
  return envelope(true, "ok", await pairNotice(pairId), null)
}

function probeEnvelope(submissionId, probe, actual, success, notice) {
  return envelope(true, "ok", {
    submissionId,
    probeId: probe.probe_id,
    prompt: probe.prompt,
    actual,
    expectedReference: probe.expected_text,
    outcome: success ? "success" : "failure",
    gradingStatus: "graded",
    ...verdictFields("graded", success ? "success" : "failure"),
    confusion: notice,
  }, null)
}

/** 確認問題の回答。回答・結果・学習の状態の更新を 1 つのトランザクションで行い、再送の確認もその中で行う。 */
export async function submitProbe(operation, request) {
  const found = await query(
    `SELECT probe_id, exercise_id, pair_id, side, prompt, expected_text
     FROM skill_trainer.confusion_probes WHERE probe_id = $1`,
    [request.probe_id],
  )
  const probe = found.rows[0]
  if (!probe) return validationError("probe not found")
  const actual = request.answer_text.trim()
  const success = folded(probe.expected_text) === folded(actual)
  const attemptId = /^[0-9a-f-]{36}$/i.test(request.attempt_id || "") ? request.attempt_id : request.submission_id
  const simple = request.submission_id.replaceAll("-", "").toLowerCase()
  const side = probe.side.trim()
  const recorded = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`probe:${request.submission_id}`])
    const already = await client.query(
      "SELECT kind FROM skill_trainer.confusion_events WHERE submission_id = $1",
      [request.submission_id],
    )
    if (already.rows[0]) return already.rows[0].kind === "probe_success"
    const at = (await client.query("SELECT NOW() AS at")).rows[0].at
    await client.query(
      `INSERT INTO skill_trainer.training_attempts
         (attempt_id, learner_key, exercise_id, exercise_instance_id, actual, input_modality, response_mode, occurred_at, created_at)
       VALUES ($1, $2, $3, NULL, $4, 'text', 'confusion_probe', $5, NOW())`,
      [attemptId, operation.learnerKey, probe.exercise_id, actual, at],
    )
    await client.query(
      `INSERT INTO skill_trainer.confusion_events
         (event_id, pair_id, attempt_id, submission_id, probe_id, kind, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), probe.pair_id, attemptId, request.submission_id, probe.probe_id, success ? "probe_success" : "probe_failure", at],
    )
    await client.query(
      `INSERT INTO skill_trainer.grading_observations
         (grading_id, learner_key, training_attempt_id, source, observer_version, idempotency_key,
          status, adopted_for_evidence, rubric_version, dimension_results, reason)
       VALUES ($1, $2, $3, 'deterministic', 'confusion-probe-v1', $4,
               'graded', FALSE, 'confusion-probe:1',
               jsonb_build_object('deterministic_outcome', $5::text), NULL)`,
      [randomUUID(), operation.learnerKey, attemptId, simple + simple, success ? "pass" : "fail"],
    )
    const state = await client.query(
      `SELECT pending_sides, success_streak FROM skill_trainer.learner_confusion_state
       WHERE learner_key = $1 AND pair_id = $2 FOR UPDATE`,
      [operation.learnerKey, probe.pair_id],
    )
    const current = state.rows[0]
    const sides = Array.isArray(current?.pending_sides) ? [...current.pending_sides] : []
    if (sides[0] === side) sides.shift()
    let streak = 0
    let days = null
    let nextSides = sides
    if (success && sides.length === 0) {
      streak = Number(current?.success_streak ?? 0) + 1
      days = streak <= 1 ? 1 : streak === 2 ? 3 : 7
      nextSides = ["a", "b"]
    } else if (!success) {
      nextSides = [side, side === "a" ? "b" : "a"]
    }
    await client.query(
      `INSERT INTO skill_trainer.learner_confusion_state AS st
         (learner_key, pair_id, graded_count, success_count, confusion_count, success_streak, pending_sides, next_due_at)
       VALUES ($1, $2, 1, $3, $4, $5, $6::jsonb,
               CASE WHEN $7::int IS NULL THEN NOW() ELSE NOW() + make_interval(days => $7) END)
       ON CONFLICT (learner_key, pair_id) DO UPDATE
         SET graded_count = st.graded_count + 1,
             success_count = st.success_count + EXCLUDED.success_count,
             confusion_count = st.confusion_count + EXCLUDED.confusion_count,
             success_streak = EXCLUDED.success_streak,
             pending_sides = EXCLUDED.pending_sides,
             serving_probe_id = NULL,
             next_due_at = EXCLUDED.next_due_at,
             updated_at = NOW()`,
      [operation.learnerKey, probe.pair_id, success ? 1 : 0, success ? 0 : 1, streak, JSON.stringify(nextSides), days],
    )
    return success
  })
  return probeEnvelope(request.submission_id, probe, actual, recorded, await pairNotice(probe.pair_id))
}
