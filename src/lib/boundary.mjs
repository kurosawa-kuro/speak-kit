import { randomUUID } from "node:crypto"
import { query } from "./db.mjs"

const pair = (suffix) => `11111111-1111-4111-8111-${suffix.padStart(12, "0")}`

/** 長い目印を先に見る。短い "do you" が "do you mean" を横取りしないため。 */
const WATCHES = [
  [pair("60"), ["give me a moment"], [], ["wait a moment"], []],
  [pair("d0"), ["explain that again"], [], ["say that again"], []],
  [pair("e0"), ["more specific"], [], ["could you explain", "can you explain", "explain"], []],
  [pair("f0"), ["give me an example", "give an example"], [], ["show me"], []],
  [pair("100"), ["can i check", "could i check"], [], ["could you check", "can you check"], []],
  [pair("90"), ["what do you mean"], [], ["what does that mean"], []],
  [pair("a0"), ["you mean"], ["do you mean", "what do you mean"], ["you're saying", "you are saying"], []],
  [pair("b0"), ["are you asking"], [], ["are you saying"], []],
  [pair("c0"), ["are you referring"], [], ["are you talking"], []],
  [pair("110"), ["what happened next"], [], ["what happened"], ["what happened next"]],
  [pair("120"), ["what makes you say"], [], ["why"], []],
  [pair("130"), ["what are you doing"], [], ["what are you going to"], []],
  [pair("30"), ["did you say"], [], ["do you mean"], []],
  [pair("40"), ["do you mean"], [], ["does that mean"], []],
  [pair("50"), ["are you asking"], [], ["do you want me"], []],
  [pair("10"), ["because"], [], ["thats why"], []],
  [pair("140"), ["did you"], ["did you say"], ["were you"], []],
  [pair("20"), ["did you"], ["did you say"], ["have you ever"], []],
  [pair("70"), ["can i", "could i"], ["can i check", "could i check"], ["could you", "can you"], ["could you check", "can you check", "wait a moment", "give me a moment"]],
  [pair("150"), ["can you", "can i"], [], ["could you", "could i"], []],
  [pair("150"), ["can"], ["can you", "can i"], ["could"], ["could you", "could i"]],
  [pair("160"), ["going to"], ["what are you going to"], ["will", "i'll", "we'll", "you'll", "they'll", "it'll"], []],
  [pair("170"), ["want to"], [], ["would like"], []],
  [pair("80"), ["are you"], ["are you asking", "are you saying", "are you talking", "are you referring", "what are you"], ["do you"], ["do you mean", "do you want"]],
  [pair("180"), ["any", "anything", "anyone", "anybody", "anywhere"], [], ["some", "something", "someone", "somebody", "somewhere"], []],
  [pair("190"), ["many"], [], ["much"], []],
  [pair("1a0"), ["say", "says", "said"], ["say that again", "did you say", "are you saying", "you're saying", "you are saying", "what makes you say"], ["tell", "tells", "told"], []],
  [pair("1b0"), ["look", "looks", "looked", "looking"], [], ["see", "sees", "saw", "seen", "seeing"], []],
  [pair("1c0"), ["look", "looks", "looked", "looking"], [], ["watch", "watches", "watched", "watching"], []],
  [pair("1d0"), ["see", "sees", "saw", "seen", "seeing"], [], ["watch", "watches", "watched", "watching"], []],
  [pair("1e0"), ["hear", "hears", "heard", "hearing"], [], ["listen", "listens", "listened", "listening"], []],
  [pair("1f0"), ["job", "jobs"], [], ["work", "works", "worked", "working"], []],
  [pair("200"), ["fun"], [], ["funny"], []],
]

export function folded(input) {
  return String(input)
    .toLowerCase()
    .replaceAll("’", "'")
    .replaceAll("‘", "'")
    .replace(/[^\p{L}\p{N}']/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replaceAll("that's", "thats")
    .replaceAll("that is", "thats")
}

function hasPhrase(text, phrase) {
  return ` ${text} `.includes(` ${phrase} `)
}

function sideUsed(text, markers, blockers) {
  if (blockers.some((blocker) => hasPhrase(text, blocker))) return false
  return markers.some((marker) => hasPhrase(text, marker))
}

export function boundaryCrossed(canonical, expected, actual) {
  const target = `${folded(canonical)} ${folded(expected)}`
  const answer = folded(actual)
  for (const [pairId, markersA, blockersA, markersB, blockersB] of WATCHES) {
    const targetA = sideUsed(target, markersA, blockersA)
    const targetB = sideUsed(target, markersB, blockersB)
    const usedA = sideUsed(answer, markersA, blockersA)
    const usedB = sideUsed(answer, markersB, blockersB)
    if (targetA && !targetB && usedB && !usedA) return { pairId, missed: "a" }
    if (targetB && !targetA && usedA && !usedB) return { pairId, missed: "b" }
  }
  return null
}

export async function noteBoundaryMiss(attemptId, canonical, expected, actual) {
  const hit = boundaryCrossed(canonical, expected, actual)
  if (!hit) return
  const inserted = await query(
    `INSERT INTO skill_trainer.confusion_events (event_id, pair_id, attempt_id, kind)
     VALUES ($1, $2, $3, 'mistake')
     ON CONFLICT (attempt_id) DO NOTHING`,
    [randomUUID(), hit.pairId, attemptId],
  )
  if (!inserted.rowCount) return
  const sides = hit.missed === "a" ? ["a", "b"] : ["b", "a"]
  await query(
    `UPDATE skill_trainer.confusion_pairs
     SET confusion_count = confusion_count + 1,
         graded_count = graded_count + 1,
         success_streak = 0,
         pending_sides = $2::jsonb,
         serving_probe_id = NULL,
         next_due_at = NOW(),
         source = CASE WHEN source = 'catalog' THEN 'observed_mistake' ELSE source END
     WHERE pair_id = $1`,
    [hit.pairId, JSON.stringify(sides)],
  )
}

const PAIR_COLUMNS = `pair_id, label_a, label_b, key_a, direction_a, key_b, direction_b,
  confusion_type, graded_count, success_count, confusion_count, success_streak,
  pending_sides, serving_probe_id, next_due_at`

export function pairJson(row, probe = null) {
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

export async function loadPair(pairId) {
  const found = await query(
    `SELECT ${PAIR_COLUMNS} FROM skill_trainer.confusion_pairs WHERE pair_id = $1`,
    [pairId],
  )
  return found.rows[0]
}

export async function nextDueNotice() {
  const due = await query(
    `SELECT ${PAIR_COLUMNS}
     FROM skill_trainer.confusion_pairs
     WHERE learner_key = 'default' AND next_due_at IS NOT NULL AND next_due_at <= NOW()
     ORDER BY next_due_at
     LIMIT 1`,
  )
  const row = due.rows[0]
  if (!row) return null
  let probe = null
  if (row.serving_probe_id) {
    const serving = await query(
      `SELECT probe_id, exercise_id, pair_id, side, prompt, expected_text
       FROM skill_trainer.confusion_probes WHERE probe_id = $1`,
      [row.serving_probe_id],
    )
    probe = serving.rows[0] || null
  }
  if (!probe) {
    const side = Array.isArray(row.pending_sides) && typeof row.pending_sides[0] === "string"
      ? row.pending_sides[0]
      : "a"
    const picked = await query(
      `SELECT probe_id, exercise_id, pair_id, side, prompt, expected_text
       FROM skill_trainer.confusion_probes
       WHERE pair_id = $1 AND side = $2
       ORDER BY last_served_at NULLS FIRST, ordinal
       LIMIT 1`,
      [row.pair_id, side],
    )
    probe = picked.rows[0] || null
    if (probe) {
      await query(`UPDATE skill_trainer.confusion_pairs SET serving_probe_id = $2 WHERE pair_id = $1`, [row.pair_id, probe.probe_id])
      await query(`UPDATE skill_trainer.confusion_probes SET last_served_at = NOW() WHERE probe_id = $1`, [probe.probe_id])
    }
  }
  if (!probe) return null
  return pairJson(row, probe)
}

export async function pairNotice(pairId) {
  const row = await loadPair(pairId)
  if (row.next_due_at && new Date(row.next_due_at) <= new Date()) {
    return (await nextDueNotice()) || pairJson(row)
  }
  return pairJson(row)
}

export async function noticeForAttempt(attemptId) {
  const linked = await query(
    `SELECT pair_id FROM skill_trainer.confusion_events WHERE attempt_id = $1`,
    [attemptId],
  )
  const pairId = linked.rows[0]?.pair_id
  return pairId ? pairNotice(pairId) : null
}

export async function duePractice(aiAvailable) {
  const notice = await nextDueNotice()
  if (!notice) return null
  const probe = notice.probe
  return {
    practiceId: probe.probeId,
    source: "confusion_probe",
    policyVersion: "phase1-adaptive-v2",
    trainingMode: "contrast_drill",
    capability: "CONTRAST_SELECTION",
    skill: {
      skillKey: "confusion-pair",
      canonicalForm: `${notice.labelA} / ${notice.labelB}`,
      meaning: `${notice.labelA} と ${notice.labelB} の違い`,
      category: "OUTPUT",
    },
    exercise: {
      exerciseKey: "confusion-probe",
      exerciseVersion: 1,
      exerciseInstanceId: probe.probeId,
      prompt: probe.prompt,
      expectedReference: probe.expectedReference,
      modality: "text",
      confusionProbeId: probe.probeId,
    },
    confusion: notice,
    aiAvailable,
  }
}

export async function listPairs() {
  const rows = await query(
    `SELECT ${PAIR_COLUMNS}
     FROM skill_trainer.confusion_pairs
     WHERE learner_key = 'default' AND graded_count > 0
     ORDER BY confusion_count DESC, label_a`,
  )
  return rows.rows.map((row) => pairJson(row))
}

export async function watchCount() {
  const counted = await query(`SELECT count(*)::int AS count FROM skill_trainer.confusion_pairs WHERE learner_key = 'default'`)
  return counted.rows[0].count
}
