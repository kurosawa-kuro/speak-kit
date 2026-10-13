import { randomUUID } from "node:crypto"
import { askClaude } from "./ai/client.mjs"
import { aiEnabled } from "./ai/isEnabled.mjs"
import { envelope, validationError } from "./envelope.mjs"
import { query } from "./db.mjs"

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

function folded(input) {
  const spaced = input
    .toLowerCase()
    .replaceAll("’", "'")
    .replaceAll("‘", "'")
    .replace(/[^a-z0-9']/giu, " ")
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replaceAll("that's", "thats")
    .replaceAll("that is", "thats")
}

function parseDraft(raw) {
  if (!raw) return null
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(raw.slice(start, end + 1))
    const draft = {}
    for (const key of DRAFT_FIELDS) {
      const field = typeof value[key] === "string" ? value[key].trim() : ""
      if (!field) return null
      draft[key] = field
    }
    return draft
  } catch {
    return null
  }
}

async function discriminationDraft(labelA, labelB) {
  if (!aiEnabled()) return null
  const asked = await askClaude(
    "あなたは二つの似た候補の境界だけを作る。共通点や長い解説は書かない。JSONだけを返す。",
    `候補A: ${labelA}\n候補B: ${labelB}\nAとBを取り違えないための最小の識別を、それぞれ一語か短い句で返す。確認問題はA用2問、B用2問。4問は別の文脈にする。同じ文の言い換えにしない。期待する回答は、その候補を使った短い完成文か、候補そのものの名称。\n{"key_a":"","direction_a":"","key_b":"","direction_b":"","probe_a1_prompt":"","probe_a1_expected":"","probe_b1_prompt":"","probe_b1_expected":"","probe_a2_prompt":"","probe_a2_expected":"","probe_b2_prompt":"","probe_b2_expected":""}`,
    { maxTokens: 800, timeoutMs: 45000 },
  )
  return asked.ok ? parseDraft(asked.data.text) : null
}

function notice(row, probe) {
  return {
    pairId: row.pair_id,
    labelA: row.label_a,
    labelB: row.label_b,
    keyA: row.key_a,
    directionA: row.direction_a,
    keyB: row.key_b,
    directionB: row.direction_b,
    confusionType: row.confusion_type,
    gradedCount: row.graded_count,
    successCount: row.success_count,
    confusionCount: row.confusion_count,
    probe: probe
      ? { probeId: probe.probe_id, prompt: probe.prompt, expectedReference: probe.expected_text }
      : null,
  }
}

export async function registerPair(request) {
  const rawA = request.label_a.trim()
  const rawB = request.label_b.trim()
  const draft = await discriminationDraft(rawA, rawB)
  if (!draft) {
    return envelope(false, "confusion_key_unavailable", {}, { message: "違いを作れませんでした: ANTHROPIC_API_KEY is unset" })
  }
  const swapped = rawA >= rawB
  const labelA = swapped ? rawB : rawA
  const labelB = swapped ? rawA : rawB
  const keyA = swapped ? draft.key_b : draft.key_a
  const directionA = swapped ? draft.direction_b : draft.direction_a
  const keyB = swapped ? draft.key_a : draft.key_b
  const directionB = swapped ? draft.direction_a : draft.direction_b
  const probes = swapped
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
  for (const [side, ordinal, prompt, expected] of probes) {
    await query(
      `INSERT INTO skill_trainer.confusion_probes
         (probe_id, pair_id, side, ordinal, prompt, expected_text)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (pair_id, side, ordinal) DO UPDATE
         SET prompt = EXCLUDED.prompt, expected_text = EXCLUDED.expected_text`,
      [randomUUID(), pairId, side, ordinal, prompt, expected],
    )
  }
  const pair = await query(
    `SELECT pair_id, label_a, label_b, key_a, direction_a, key_b, direction_b, confusion_type,
            graded_count, success_count, confusion_count
     FROM skill_trainer.confusion_pairs WHERE pair_id = $1`,
    [pairId],
  )
  const probe = await query(
    `SELECT probe_id, prompt, expected_text
     FROM skill_trainer.confusion_probes
     WHERE pair_id = $1 AND side = 'a' AND ordinal = 1`,
    [pairId],
  )
  return envelope(true, "ok", notice(pair.rows[0], probe.rows[0]), null)
}

export async function submitProbe(request) {
  const probe = await query(
    `SELECT probe_id, exercise_id, pair_id, side, prompt, expected_text
     FROM skill_trainer.confusion_probes WHERE probe_id = $1`,
    [request.probe_id],
  )
  const row = probe.rows[0]
  if (!row) return validationError("probe not found")
  const already = await query(
    `SELECT kind FROM skill_trainer.confusion_events WHERE submission_id = $1`,
    [request.submission_id],
  )
  const actual = request.answer_text.trim()
  if (already.rows[0]) {
    const pair = await query(
      `SELECT pair_id, label_a, label_b, key_a, direction_a, key_b, direction_b, confusion_type,
              graded_count, success_count, confusion_count
       FROM skill_trainer.confusion_pairs WHERE pair_id = $1`,
      [row.pair_id],
    )
    return envelope(true, "ok", {
      probeId: row.probe_id,
      prompt: row.prompt,
      actual,
      expectedReference: row.expected_text,
      outcome: already.rows[0].kind === "probe_success" ? "success" : "failure",
      gradingStatus: "graded",
      confusion: notice(pair.rows[0], null),
    }, null)
  }
  const success = folded(row.expected_text) === folded(actual)
  const attemptId = request.attempt_id || request.submission_id
  await query(
    `INSERT INTO skill_trainer.training_attempts
       (attempt_id, exercise_id, exercise_instance_id, actual, input_modality, response_mode, occurred_at)
     VALUES ($1, $2, NULL, $3, 'text', 'confusion_probe', NOW())`,
    [attemptId, row.exercise_id, actual],
  )
  await query(
    `INSERT INTO skill_trainer.confusion_events
       (event_id, pair_id, attempt_id, submission_id, probe_id, kind)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), row.pair_id, attemptId, request.submission_id, row.probe_id, success ? "probe_success" : "probe_failure"],
  )
  const idempotency = request.submission_id.replaceAll("-", "") + request.submission_id.replaceAll("-", "")
  await query(
    `INSERT INTO skill_trainer.grading_observations
       (grading_id, training_attempt_id, source, observer_version, idempotency_key,
        status, adopted_for_evidence, rubric_version, dimension_results, reason)
     VALUES ($1, $2, 'deterministic', 'confusion-probe-v1', $3,
             'graded', FALSE, 'confusion-probe:1',
             jsonb_build_object('deterministic_outcome', $4::text), NULL)`,
    [randomUUID(), attemptId, idempotency, success ? "pass" : "fail"],
  )
  const pair = await query(
    `SELECT pending_sides, success_streak FROM skill_trainer.confusion_pairs WHERE pair_id = $1`,
    [row.pair_id],
  )
  const pending = Array.isArray(pair.rows[0].pending_sides) ? [...pair.rows[0].pending_sides] : []
  if (pending[0] === row.side.trim()) pending.shift()
  let streak = 0
  let days = null
  let nextSides = pending
  if (success && pending.length === 0) {
    streak = Number(pair.rows[0].success_streak) + 1
    days = streak <= 1 ? 1 : streak === 2 ? 3 : 7
    nextSides = ["a", "b"]
  } else if (!success) {
    const other = row.side.trim() === "a" ? "b" : "a"
    nextSides = [row.side.trim(), other]
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
    [row.pair_id, success ? 1 : 0, success ? 0 : 1, streak, JSON.stringify(nextSides), days],
  )
  const updated = await query(
    `SELECT pair_id, label_a, label_b, key_a, direction_a, key_b, direction_b, confusion_type,
            graded_count, success_count, confusion_count
     FROM skill_trainer.confusion_pairs WHERE pair_id = $1`,
    [row.pair_id],
  )
  return envelope(true, "ok", {
    probeId: row.probe_id,
    prompt: row.prompt,
    actual,
    expectedReference: row.expected_text,
    outcome: success ? "success" : "failure",
    gradingStatus: "graded",
    confusion: notice(updated.rows[0], null),
  }, null)
}
