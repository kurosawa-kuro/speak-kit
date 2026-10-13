import { randomUUID } from "node:crypto"
import { askClaude } from "./ai/client.mjs"
import { aiEnabled } from "./ai/isEnabled.mjs"
import { envelope, validationError } from "./envelope.mjs"
import { query, withTransaction } from "./db.mjs"
import { folded, loadPair, pairNotice } from "./boundary.mjs"

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

async function discriminationDraft(labelA, labelB) {
  if (!aiEnabled()) return { error: "ANTHROPIC_API_KEY is unset" }
  const asked = await askClaude(
    "あなたは二つの似た候補の境界だけを作る。共通点や長い解説は書かない。JSONだけを返す。",
    `候補A: ${labelA}\n候補B: ${labelB}\nAとBを取り違えないための最小の識別を、それぞれ一語か短い句で返す。確認問題はA用2問、B用2問。4問は別の文脈にする。同じ文の言い換えにしない。期待する回答は、その候補を使った短い完成文か、候補そのものの名称。`,
    { maxTokens: 800, timeoutMs: 45000, jsonSchema: DRAFT_SCHEMA },
  )
  if (!asked.ok) return { error: asked.error?.message || asked.code }
  return parseDraft(asked.data.text)
}

export async function registerPair(request) {
  const rawA = request.label_a.trim()
  const rawB = request.label_b.trim()
  const { draft, error } = await discriminationDraft(rawA, rawB)
  if (!draft) {
    return envelope(false, "confusion_key_unavailable", {}, { message: `違いを作れませんでした: ${error}` })
  }
  const keepOrder = rawA.toLowerCase() < rawB.toLowerCase()
  const labelA = keepOrder ? rawA : rawB
  const labelB = keepOrder ? rawB : rawA
  const keyA = keepOrder ? draft.key_a : draft.key_b
  const directionA = keepOrder ? draft.direction_a : draft.direction_b
  const keyB = keepOrder ? draft.key_b : draft.key_a
  const directionB = keepOrder ? draft.direction_b : draft.direction_a
  await query(
    `INSERT INTO skill_trainer.confusion_pairs
       (pair_id, label_a, label_b, key_a, direction_a, key_b, direction_b, source, pending_sides, next_due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'learner_registered', '["a","b"]'::jsonb, NOW())
     ON CONFLICT (learner_key, label_a, label_b) DO UPDATE
       SET key_a = EXCLUDED.key_a, direction_a = EXCLUDED.direction_a,
           key_b = EXCLUDED.key_b, direction_b = EXCLUDED.direction_b,
           pending_sides = '["a","b"]'::jsonb, next_due_at = NOW(), serving_probe_id = NULL`,
    [randomUUID(), labelA, labelB, keyA, directionA, keyB, directionB],
  )
  const stored = await query(
    `SELECT pair_id FROM skill_trainer.confusion_pairs
     WHERE learner_key = 'default' AND label_a = $1 AND label_b = $2`,
    [labelA, labelB],
  )
  const pairId = stored.rows[0].pair_id
  const probes = labelA === rawB
    ? [
      ["a", 1, draft.probe_b1_prompt, draft.probe_b1_expected],
      ["b", 1, draft.probe_a1_prompt, draft.probe_a1_expected],
      ["a", 2, draft.probe_b2_prompt, draft.probe_b2_expected],
      ["b", 2, draft.probe_a2_prompt, draft.probe_a2_expected],
    ]
    : [
      ["a", 1, draft.probe_a1_prompt, draft.probe_a1_expected],
      ["b", 1, draft.probe_b1_prompt, draft.probe_b1_expected],
      ["a", 2, draft.probe_a2_prompt, draft.probe_a2_expected],
      ["b", 2, draft.probe_b2_prompt, draft.probe_b2_expected],
    ]
  for (const [side, ordinal, prompt, expected] of probes) {
    await query(
      `INSERT INTO skill_trainer.confusion_probes
         (probe_id, pair_id, side, ordinal, prompt, expected_text)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (pair_id, side, ordinal) DO UPDATE
         SET prompt = EXCLUDED.prompt, expected_text = EXCLUDED.expected_text, last_served_at = NULL`,
      [randomUUID(), pairId, side, ordinal, prompt, expected],
    )
  }
  return envelope(true, "ok", await pairNotice(pairId), null)
}

function probeEnvelope(probe, actual, success, notice) {
  return envelope(true, "ok", {
    submissionId: notice.pairId,
    probeId: probe.probe_id,
    prompt: probe.prompt,
    actual,
    expectedReference: probe.expected_text,
    outcome: success ? "success" : "failure",
    gradingStatus: "graded",
    confusion: notice,
  }, null)
}

export async function submitProbe(request) {
  const found = await query(
    `SELECT probe_id, exercise_id, pair_id, side, prompt, expected_text
     FROM skill_trainer.confusion_probes WHERE probe_id = $1`,
    [request.probe_id],
  )
  const probe = found.rows[0]
  if (!probe) return validationError("probe not found")
  const actual = request.answer_text.trim()
  const already = await query(
    `SELECT kind FROM skill_trainer.confusion_events WHERE submission_id = $1`,
    [request.submission_id],
  )
  if (already.rows[0]) {
    return probeEnvelope(probe, actual, already.rows[0].kind === "probe_success", await pairNotice(probe.pair_id))
  }
  const success = folded(probe.expected_text) === folded(actual)
  const attemptId = /^[0-9a-f-]{36}$/i.test(request.attempt_id || "") ? request.attempt_id : request.submission_id
  const simple = request.submission_id.replaceAll("-", "").toLowerCase()
  await withTransaction(async (client) => {
    const occurred = await client.query("SELECT NOW() AS at")
    const at = occurred.rows[0].at
    await client.query(
      `INSERT INTO skill_trainer.training_attempts
         (attempt_id, exercise_id, exercise_instance_id, actual, input_modality, response_mode, occurred_at, created_at)
       VALUES ($1, $2, NULL, $3, 'text', 'confusion_probe', $4, NOW())`,
      [attemptId, probe.exercise_id, actual, at],
    )
    await client.query(
      `INSERT INTO skill_trainer.confusion_events
         (event_id, pair_id, attempt_id, submission_id, probe_id, kind, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), probe.pair_id, attemptId, request.submission_id, probe.probe_id, success ? "probe_success" : "probe_failure", at],
    )
    await client.query(
      `INSERT INTO skill_trainer.grading_observations
         (grading_id, training_attempt_id, source, observer_version, idempotency_key,
          status, adopted_for_evidence, rubric_version, dimension_results, reason)
       VALUES ($1, $2, 'deterministic', 'confusion-probe-v1', $3,
               'graded', FALSE, 'confusion-probe:1',
               jsonb_build_object('deterministic_outcome', $4::text), NULL)`,
      [randomUUID(), attemptId, simple + simple, success ? "pass" : "fail"],
    )
  })
  const pair = await loadPair(probe.pair_id)
  const sides = Array.isArray(pair.pending_sides) ? [...pair.pending_sides] : []
  if (sides[0] === probe.side.trim()) sides.shift()
  let streak = 0
  let days = null
  let nextSides = sides
  if (success && sides.length === 0) {
    streak = Number(pair.success_streak) + 1
    days = streak <= 1 ? 1 : streak === 2 ? 3 : 7
    nextSides = ["a", "b"]
  } else if (!success) {
    const other = probe.side.trim() === "a" ? "b" : "a"
    nextSides = [probe.side.trim(), other]
  }
  await query(
    `UPDATE skill_trainer.confusion_pairs
     SET graded_count = graded_count + 1,
         success_count = success_count + $2,
         confusion_count = confusion_count + $3,
         success_streak = $4,
         pending_sides = $5::jsonb,
         serving_probe_id = NULL,
         next_due_at = CASE WHEN $6::int IS NULL THEN NOW() ELSE NOW() + make_interval(days => $6) END
     WHERE pair_id = $1`,
    [probe.pair_id, success ? 1 : 0, success ? 0 : 1, streak, JSON.stringify(nextSides), days],
  )
  return probeEnvelope(probe, actual, success, await pairNotice(probe.pair_id))
}
