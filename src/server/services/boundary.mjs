import { randomUUID } from "node:crypto"
import { query } from "../db.mjs"
import { boundaryCrossed, folded } from "../domain/boundary.mjs"

export { folded }

/** 回答が混同ペアの反対側を使っていたら、記録して学習の状態を更新する。 */
export async function noteBoundaryMiss(attemptId, canonical, expected, actual, db = { query }) {
  const hit = boundaryCrossed(canonical, expected, actual)
  if (!hit) return
  const inserted = await db.query(
    `INSERT INTO skill_trainer.confusion_events (event_id, pair_id, attempt_id, kind)
     VALUES ($1, $2, $3, 'mistake')
     ON CONFLICT (attempt_id) DO NOTHING`,
    [randomUUID(), hit.pairId, attemptId],
  )
  if (!inserted.rowCount) return
  const sides = hit.missed === "a" ? ["a", "b"] : ["b", "a"]
  await db.query(
    `INSERT INTO skill_trainer.learner_confusion_state AS st
       (learner_key, pair_id, confusion_count, graded_count, success_streak, pending_sides, next_due_at, first_observed_at)
     VALUES ('default', $1, 1, 1, 0, $2::jsonb, NOW(), NOW())
     ON CONFLICT (learner_key, pair_id) DO UPDATE
       SET confusion_count = st.confusion_count + 1,
           graded_count = st.graded_count + 1,
           success_streak = 0,
           pending_sides = EXCLUDED.pending_sides,
           serving_probe_id = NULL,
           next_due_at = NOW(),
           first_observed_at = COALESCE(st.first_observed_at, NOW()),
           updated_at = NOW()`,
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
    `SELECT ${PAIR_COLUMNS} FROM skill_trainer.learner_confusion_pairs WHERE learner_key = 'default' AND pair_id = $1`,
    [pairId],
  )
  return found.rows[0]
}

export async function nextDueNotice() {
  const due = await query(
    `SELECT ${PAIR_COLUMNS}
     FROM skill_trainer.learner_confusion_pairs
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
      `SELECT p.probe_id, p.exercise_id, p.pair_id, p.side, p.prompt, p.expected_text
       FROM skill_trainer.confusion_probes p
       LEFT JOIN skill_trainer.learner_probe_state ps ON ps.probe_id = p.probe_id AND ps.learner_key = 'default'
       WHERE p.pair_id = $1 AND p.side = $2
       ORDER BY ps.last_served_at NULLS FIRST, p.ordinal
       LIMIT 1`,
      [row.pair_id, side],
    )
    probe = picked.rows[0] || null
    if (probe) {
      await query(
        `UPDATE skill_trainer.learner_confusion_state SET serving_probe_id = $2, updated_at = NOW()
         WHERE learner_key = 'default' AND pair_id = $1`,
        [row.pair_id, probe.probe_id],
      )
      await query(
        `INSERT INTO skill_trainer.learner_probe_state (learner_key, probe_id, last_served_at)
         VALUES ('default', $1, NOW())
         ON CONFLICT (learner_key, probe_id) DO UPDATE SET last_served_at = NOW()`,
        [probe.probe_id],
      )
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

export async function duePractice(availability) {
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
    ...availability,
  }
}

export async function listPairs() {
  const rows = await query(
    `SELECT ${PAIR_COLUMNS}
     FROM skill_trainer.learner_confusion_pairs
     WHERE learner_key = 'default' AND graded_count > 0
     ORDER BY confusion_count DESC, label_a`,
  )
  return rows.rows.map((row) => pairJson(row))
}

export async function watchCount() {
  const counted = await query(`SELECT count(*)::int AS count FROM skill_trainer.confusion_pairs`)
  return counted.rows[0].count
}
