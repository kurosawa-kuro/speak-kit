import { createHash, randomUUID } from "node:crypto"
import { recognizedNotRecalled } from "../domain/verdict.mjs"
import { envelope, validationError } from "../http/envelope.mjs"
import { query, withTransaction } from "../db.mjs"

const SPACING = 3
const PROMOTION_WINDOW = 10
const PROMOTION_STABLE_ITEMS = 2
const RESET_AT = `COALESCE((SELECT max(requested_at) FROM skill_trainer.review_resets
  WHERE learner_key = 'default' AND domain_id = (SELECT id FROM skill_trainer.domains WHERE code = 'english_conversation')),
  '-infinity'::timestamptz)`

function stateCte() {
  return `WITH att AS (
    SELECT a.item_key, a.pair_id, a.skill_id, a.outcome, a.answered_at,
           coalesce(a.pair_id::text, 'skill:' || a.skill_id::text) AS target,
           row_number() OVER (ORDER BY a.answered_at, a.attempt_id) AS seq
    FROM skill_trainer.quiz_attempts a
    WHERE a.learner_key = 'default' AND a.answered_at > ${RESET_AT}
  ),
  per_item AS (
    SELECT item_key,
           (array_agg(outcome ORDER BY seq DESC))[1] AS last_outcome,
           (array_agg(outcome ORDER BY seq DESC))[2] AS prev_outcome,
           (array_agg(seq ORDER BY seq DESC))[1] AS last_seq,
           (array_agg(seq ORDER BY seq DESC))[2] AS prev_seq,
           max(answered_at) AS last_answered_at
    FROM att GROUP BY item_key
  ),
  total AS (SELECT coalesce(max(seq), 0)::bigint AS max_seq FROM att),
  recent_targets AS (SELECT target FROM att ORDER BY seq DESC LIMIT ${SPACING}),
  item_state AS (
    SELECT qi.item_key, qi.option_set_version, qi.pair_id, qi.skill_id, qi.quiz_type,
           coalesce(qi.pair_id::text, 'skill:' || qi.skill_id::text) AS target,
           pi.last_outcome, pi.last_seq,
           (pi.last_answered_at AT TIME ZONE 'Asia/Tokyo')::date
             < (NOW() AT TIME ZONE 'Asia/Tokyo')::date AS answered_before_today,
           (pi.last_outcome = 'success' AND pi.prev_outcome = 'success'
              AND pi.last_seq - pi.prev_seq - 1 >= ${SPACING}) IS TRUE AS stable,
           EXISTS (
             SELECT 1 FROM skill_trainer.quiz_attempts earlier
             WHERE earlier.learner_key = 'default'
               AND earlier.item_key = qi.item_key
               AND earlier.outcome = 'success'
               AND earlier.answered_at <= ${RESET_AT}
           ) AS answered_before_reset,
           (qi.quiz_type = 'form' AND NOT EXISTS (
             SELECT 1 FROM att stage_one
             JOIN skill_trainer.quiz_items stage_item ON stage_item.item_key = stage_one.item_key
             WHERE stage_item.skill_id = qi.skill_id
               AND stage_item.quiz_type IN ('meaning', 'intent')
               AND stage_one.outcome = 'success'
           )) AS gated,
           CASE
             WHEN qi.pair_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM skill_trainer.learner_confusion_state cs
               WHERE cs.learner_key = 'default' AND cs.pair_id = qi.pair_id AND cs.confusion_count > 0
             ) THEN 0
             WHEN qi.skill_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM skill_trainer.effective_capability_evidence e
               WHERE e.skill_id = qi.skill_id AND e.capability = 'CONTROLLED_RECALL'
             ) THEN 1
             ELSE 2
           END AS route_rank,
           CASE qi.quiz_type WHEN 'meaning' THEN 0 WHEN 'intent' THEN 0 WHEN 'contrast' THEN 1 ELSE 2 END
             AS stage_rank
    FROM skill_trainer.quiz_items qi
    LEFT JOIN per_item pi ON pi.item_key = qi.item_key
    WHERE qi.status = 'active'
  )`
}

function typeFilter(request) {
  const quizType = text(request, "quiz_type")
  if (quizType === "meaning") return "s.quiz_type = 'meaning'"
  if (quizType === "intent") return "s.quiz_type = 'intent'"
  if (quizType === "contrast") return "s.quiz_type IN ('contrast', 'form')"
  if (quizType === "form") return "s.quiz_type = 'form'"
  return "TRUE"
}

function text(request, key) {
  const value = request?.[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "")
}

function displayForm(canonical) {
  let out = ""
  let inSlot = false
  for (const ch of canonical || "") {
    if (ch === "{") {
      inSlot = true
      out += "..."
    } else if (ch === "}") {
      inSlot = false
    } else if (!inSlot) {
      out += ch
    }
  }
  return out
}

function optionText(options, id) {
  const found = (options || []).find((option) => option?.id === id)
  if (!found) return null
  return [found.text || "", found.kind || "near"]
}

function optionIds(options) {
  return (options || []).map((option) => option?.id).filter(Boolean).sort()
}

async function countPair(filter) {
  const result = await query(
    `${stateCte()} SELECT count(*) FILTER (WHERE s.stable)::bigint AS stable_count, count(*)::bigint AS item_count FROM item_state s WHERE ${filter}`,
  )
  return [Number(result.rows[0].stable_count), Number(result.rows[0].item_count)]
}

export async function quizNext(request) {
  const filter = typeFilter(request)
  const picked = await query(
    `${stateCte()} SELECT s.item_key, s.option_set_version, s.quiz_type, qi.prompt,
       (SELECT jsonb_agg(jsonb_build_object('id', o ->> 'id', 'text', o ->> 'text') ORDER BY random())
        FROM jsonb_array_elements(qi.options) o) AS options
     FROM item_state s
     JOIN skill_trainer.quiz_items qi
       ON qi.item_key = s.item_key AND qi.option_set_version = s.option_set_version
     CROSS JOIN total
     WHERE NOT s.stable AND NOT s.gated AND ${filter}
     ORDER BY (s.last_seq IS NULL OR total.max_seq - s.last_seq >= ${SPACING}) DESC,
              CASE
                WHEN s.last_outcome = 'failure' THEN 0
                WHEN s.last_outcome = 'success' AND s.answered_before_today THEN 1
                WHEN s.last_outcome IS NULL AND s.answered_before_reset THEN 2
                WHEN s.last_outcome IS NULL THEN 3
                ELSE 4
              END,
              s.route_rank,
              s.stage_rank,
              s.target IN (SELECT target FROM recent_targets),
              random()
     LIMIT 1`,
  )
  const [stableCount, itemCount] = await countPair(filter)
  const formReady = await query(
    `SELECT EXISTS (
       SELECT 1 FROM skill_trainer.quiz_attempts
       WHERE learner_key = 'default' AND quiz_type IN ('meaning', 'intent') AND outcome = 'success'
     ) AS ready`,
  )
  const row = picked.rows[0]
  const item = row
    ? {
        itemKey: row.item_key,
        optionSetVersion: row.option_set_version,
        quizType: row.quiz_type,
        prompt: row.prompt,
        options: row.options,
      }
    : null
  return envelope(
    true,
    "ok",
    {
      item,
      stableCount,
      itemCount,
      formReady: formReady.rows[0]?.ready === true,
      message: item
        ? null
        : "いま出せる問題は、すべて安定しました。もう一度確かめるには、記録の「覚えたものを再チェック」を押します。",
    },
    null,
  )
}

async function loadItem(itemKey, version) {
  const result = await query(
    `SELECT qi.exercise_id, qi.item_key, qi.option_set_version, qi.pair_id, qi.skill_id, qi.quiz_type,
            qi.capability, qi.prompt, qi.options, qi.correct_option_id,
            pr.side::text AS side, sc.stable_key AS skill_key,
            sc.canonical_form AS skill_form, sc.meaning AS skill_meaning
     FROM skill_trainer.quiz_items qi
     LEFT JOIN skill_trainer.confusion_probes pr ON pr.probe_id = qi.probe_id
     LEFT JOIN skill_trainer.skill_concepts sc ON sc.id = qi.skill_id
     WHERE qi.item_key = $1 AND qi.option_set_version = $2`,
    [itemKey, version],
  )
  return result.rows[0] || null
}

async function resultPayload(item, selected, success, promoted) {
  let pair = null
  if (item.pair_id) {
    const loaded = await query(
      `SELECT label_a, key_a, direction_a, label_b, key_b, direction_b, confusion_type
       FROM skill_trainer.confusion_pairs WHERE pair_id = $1`,
      [item.pair_id],
    )
    pair = loaded.rows[0]
  }
  const stable = await query(
    `${stateCte()} SELECT coalesce(bool_or(stable), false) AS stable FROM item_state WHERE item_key = $1`,
    [item.item_key],
  )
  const [stableCount, itemCount] = await countPair("TRUE")
  const selectedPair = optionText(item.options, selected) || ["", "near"]
  const correctPair = optionText(item.options, item.correct_option_id) || ["", "correct"]
  const skill = item.skill_key
    ? { skillKey: item.skill_key, form: displayForm(item.skill_form || ""), meaning: item.skill_meaning }
    : null
  const difference = pair
    ? {
        labelA: pair.label_a,
        keyA: pair.key_a,
        directionA: pair.direction_a,
        labelB: pair.label_b,
        keyB: pair.key_b,
        directionB: pair.direction_b,
        confusionType: pair.confusion_type,
      }
    : null
  const correctLabel = pair ? (item.side?.trim() === "a" ? pair.label_a : pair.label_b) : null
  const promotion = promoted
    ? pair
      ? { kind: "pair", label: `${pair.label_a} と ${pair.label_b}` }
      : { kind: "skill", skillKey: item.skill_key, label: displayForm(item.skill_form || "") }
    : null
  return envelope(
    true,
    "ok",
    {
      itemKey: item.item_key,
      quizType: item.quiz_type,
      prompt: item.prompt,
      outcome: success ? "success" : "failure",
      selectedOptionId: selected,
      correctOptionId: item.correct_option_id,
      selectedText: selectedPair[0],
      selectedKind: selectedPair[1],
      correctText: correctPair[0],
      correctLabel,
      confusedLabel: pair && selectedPair[1] === "pair" ? (correctLabel === pair.label_a ? pair.label_b : pair.label_a) : null,
      difference,
      skill,
      itemStable: stable.rows[0]?.stable === true,
      stableCount,
      itemCount,
      promotion,
    },
    null,
  )
}

export async function quizAnswer(request) {
  const submissionId = text(request, "submission_id")
  if (!isUuid(submissionId)) return validationError("submission_id must be a UUID")
  const stored = await query(
    `SELECT item_key, option_set_version, selected_option_id, outcome, answered_at
     FROM skill_trainer.quiz_attempts WHERE submission_id = $1`,
    [submissionId],
  )
  if (stored.rows[0]) {
    const item = await loadItem(stored.rows[0].item_key, stored.rows[0].option_set_version)
    if (!item) return validationError("quiz item not found")
    const promoted = await query(
      `SELECT EXISTS (SELECT 1 FROM skill_trainer.quiz_promotions
                      WHERE learner_key = 'default' AND promoted_at = $3
                        AND (pair_id = $1 OR skill_id = $2)) AS promoted`,
      [item.pair_id, item.skill_id, stored.rows[0].answered_at],
    )
    return resultPayload(item, stored.rows[0].selected_option_id, stored.rows[0].outcome === "success", promoted.rows[0].promoted)
  }
  const itemKey = text(request, "item_key")
  if (!itemKey) return validationError("item_key is required")
  const version = request?.option_set_version
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return validationError("option_set_version is required")
  }
  const selected = text(request, "selected_option_id")
  if (!selected) return validationError("selected_option_id is required")
  const item = await loadItem(itemKey, version)
  if (!item) return validationError("quiz item not found")
  const selectedKind = optionText(item.options, selected)
  if (!selectedKind) return validationError("selected_option_id is not one of the options")
  const shown = Array.isArray(request.option_order)
    ? request.option_order.filter((value) => typeof value === "string").slice().sort()
    : []
  if (shown.join("\0") !== optionIds(item.options).join("\0")) {
    return validationError("option_order must list the shown options")
  }
  const latency = request.latency_ms
  const latencyMs = Number.isInteger(latency) && latency >= 0 ? latency : null
  const success = selected === item.correct_option_id
  const answeredAt = new Date()
  const trainingAttemptId = isUuid(text(request, "attempt_id")) ? text(request, "attempt_id") : submissionId
  const idempotency = submissionId.replaceAll("-", "") + submissionId.replaceAll("-", "")
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO skill_trainer.training_attempts
         (attempt_id, exercise_id, exercise_instance_id, actual, input_modality, response_mode, latency_ms, occurred_at, created_at)
       VALUES ($1, $2, NULL, $3, 'text', 'choice', $4, $5, now())`,
      [trainingAttemptId, item.exercise_id, selected, latencyMs, answeredAt],
    )
    await client.query(
      `INSERT INTO skill_trainer.quiz_attempts
         (attempt_id, submission_id, training_attempt_id, item_key, option_set_version, pair_id,
          skill_id, quiz_type, capability, response_mode, modality, option_order,
          selected_option_id, correct_option_id, selected_kind, outcome, latency_ms, answered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'choice', 'multiple_choice',
               $10, $11, $12, $13, $14, $15, $16)`,
      [
        randomUUID(),
        submissionId,
        trainingAttemptId,
        item.item_key,
        item.option_set_version,
        item.pair_id,
        item.skill_id,
        item.quiz_type,
        item.capability,
        JSON.stringify(request.option_order),
        selected,
        item.correct_option_id,
        selectedKind[1],
        success ? "success" : "failure",
        latencyMs,
        answeredAt,
      ],
    )
    await client.query(
      `INSERT INTO skill_trainer.grading_observations
         (grading_id, training_attempt_id, source, observer_version, idempotency_key,
          status, adopted_for_evidence, rubric_version, dimension_results, reason)
       VALUES ($1, $2, 'deterministic', 'quiz-choice-v1', $3,
               'graded', FALSE, 'quiz-choice:1',
               jsonb_build_object('deterministic_outcome', $4::text), NULL)`,
      [randomUUID(), trainingAttemptId, idempotency, success ? "pass" : "fail"],
    )
  })
  const promoted = success ? await promoteIfReady(item, answeredAt) : false
  return resultPayload(item, selected, success, promoted)
}

async function promoteIfReady(item, answeredAt) {
  const column = item.pair_id ? "pair_id" : item.skill_id ? "skill_id" : null
  if (!column) return false
  const target = item.pair_id || item.skill_id
  const stable = await query(
    `${stateCte()} SELECT count(*)::bigint AS count FROM item_state WHERE ${column} = $1 AND stable`,
    [target],
  )
  if (Number(stable.rows[0]?.count || 0) < PROMOTION_STABLE_ITEMS) return false
  const recent = await query(
    `SELECT count(*)::bigint AS graded,
            count(*) FILTER (WHERE outcome = 'success')::bigint AS successes,
            EXISTS (
              SELECT 1 FROM skill_trainer.quiz_promotions
              WHERE learner_key = 'default' AND ${column} = $1 AND promoted_at > ${RESET_AT}
            ) AS already
     FROM (
       SELECT outcome FROM skill_trainer.quiz_attempts
       WHERE learner_key = 'default' AND ${column} = $1 AND answered_at > ${RESET_AT}
       ORDER BY answered_at DESC LIMIT ${PROMOTION_WINDOW}
     ) recent`,
    [target],
  )
  const row = recent.rows[0]
  const graded = Number(row?.graded || 0)
  const successes = Number(row?.successes || 0)
  if (row?.already || graded === 0 || successes * 10 < graded * 9) return false
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO skill_trainer.quiz_promotions (promotion_id, pair_id, skill_id, promoted_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), item.pair_id, item.pair_id ? null : item.skill_id, answeredAt],
    )
    if (item.pair_id) {
      await client.query(
        `INSERT INTO skill_trainer.learner_confusion_state AS st (learner_key, pair_id, pending_sides, next_due_at)
         VALUES ('default', $1, '["a","b"]'::jsonb, NOW())
         ON CONFLICT (learner_key, pair_id) DO UPDATE
           SET pending_sides = '["a","b"]'::jsonb, serving_probe_id = NULL, next_due_at = NOW(), updated_at = NOW()
           WHERE st.next_due_at IS NULL OR st.next_due_at > NOW()`,
        [item.pair_id],
      )
    }
  })
  return true
}

export async function quizRoute() {
  const counts = await query(
    `${stateCte()} SELECT
       (SELECT count(DISTINCT s.pair_id)::bigint FROM item_state s
        JOIN skill_trainer.learner_confusion_state cs ON cs.pair_id = s.pair_id AND cs.learner_key = 'default'
        WHERE cs.confusion_count > 0 AND NOT s.stable) AS confused,
       (SELECT count(DISTINCT s.skill_id)::bigint FROM item_state s
        WHERE s.route_rank = 1 AND NOT s.stable) AS unmeasured`,
  )
  const recall = await query(
    `SELECT sc.stable_key, sc.canonical_form, sc.meaning
     FROM skill_trainer.skill_concepts sc
     WHERE sc.status = 'active'
       AND (
         EXISTS (
           SELECT 1 FROM skill_trainer.quiz_promotions qp
           WHERE qp.learner_key = 'default' AND qp.skill_id = sc.id AND qp.promoted_at > ${RESET_AT}
             AND NOT EXISTS (
               SELECT 1 FROM skill_trainer.effective_capability_evidence e
               WHERE e.skill_id = sc.id AND e.capability = 'CONTROLLED_RECALL'
                 AND e.outcome = 'success' AND e.observed_at > qp.promoted_at
             )
         )
         OR (
           EXISTS (
             SELECT 1 FROM skill_trainer.quiz_attempts qa
             WHERE qa.skill_id = sc.id AND qa.quiz_type IN ('meaning', 'intent') AND qa.outcome = 'success'
           )
           AND (
             SELECT e.outcome FROM skill_trainer.effective_capability_evidence e
             WHERE e.skill_id = sc.id AND e.capability = 'CONTROLLED_RECALL'
             ORDER BY e.observed_at DESC LIMIT 1
           ) = 'failure'
         )
       )
     ORDER BY sc.stable_key
     LIMIT 3`,
  )
  const talk = await query(
    `SELECT sc.stable_key, sc.canonical_form, sc.meaning
     FROM skill_trainer.skill_concepts sc
     JOIN skill_trainer.effective_capability_evidence e
       ON e.skill_id = sc.id AND e.capability = 'CONTROLLED_RECALL'
     WHERE sc.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM skill_trainer.effective_capability_evidence talk
         WHERE talk.skill_id = sc.id AND talk.capability = 'CONVERSATION_USAGE' AND talk.outcome = 'success'
       )
     GROUP BY sc.id
     HAVING count(*) >= 3 AND count(*) FILTER (WHERE e.outcome = 'success') * 5 >= count(*) * 4
     ORDER BY sc.stable_key
     LIMIT 3`,
  )
  const label = (row) => ({ skillKey: row.stable_key, form: displayForm(row.canonical_form), meaning: row.meaning })
  return {
    quizConfusedPairs: Number(counts.rows[0]?.confused || 0),
    quizUnmeasuredSkills: Number(counts.rows[0]?.unmeasured || 0),
    recallReady: recall.rows.map(label),
    talkReady: talk.rows.map(label),
  }
}

export async function quizProgress() {
  const [stableCount, itemCount] = await countPair("TRUE")
  const pairs = await query(
    `${stateCte()} SELECT cp.pair_id, cp.label_a, cp.label_b, cp.confusion_type,
            count(qa.attempt_id)::int AS choice_graded,
            count(qa.attempt_id) FILTER (WHERE qa.outcome = 'success')::int AS choice_success,
            cp.success_count, cp.graded_count,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY qa.latency_ms) AS choice_p50,
            (SELECT count(*) FROM item_state s WHERE s.pair_id = cp.pair_id AND s.stable)::int AS stable_items
     FROM skill_trainer.learner_confusion_pairs cp
     JOIN skill_trainer.quiz_attempts qa ON qa.pair_id = cp.pair_id AND qa.learner_key = cp.learner_key
     WHERE cp.learner_key = 'default'
     GROUP BY cp.pair_id, cp.label_a, cp.label_b, cp.confusion_type, cp.success_count, cp.graded_count
     ORDER BY count(qa.attempt_id) DESC, cp.label_a`,
  )
  const skills = await query(
    `${stateCte()} SELECT sc.stable_key, sc.canonical_form, sc.meaning,
            count(qa.attempt_id)::int AS choice_graded,
            count(qa.attempt_id) FILTER (WHERE qa.outcome = 'success')::int AS choice_success,
            (SELECT count(*) FROM skill_trainer.effective_capability_evidence e
             WHERE e.skill_id = sc.id AND e.capability = 'CONTROLLED_RECALL')::int AS text_graded,
            (SELECT count(*) FROM skill_trainer.effective_capability_evidence e
             WHERE e.skill_id = sc.id AND e.capability = 'CONTROLLED_RECALL' AND e.outcome = 'success')::int AS text_success,
            (SELECT count(*) FROM item_state s WHERE s.skill_id = sc.id AND s.stable)::int AS stable_items,
            (SELECT count(*) FROM item_state s WHERE s.skill_id = sc.id)::int AS item_count
     FROM skill_trainer.skill_concepts sc
     JOIN skill_trainer.quiz_attempts qa ON qa.skill_id = sc.id AND qa.learner_key = 'default'
     GROUP BY sc.id
     ORDER BY count(qa.attempt_id) DESC, sc.stable_key`,
  )
  return {
    stableCount,
    itemCount,
    pairs: pairs.rows.map((row) => ({
      pairId: row.pair_id,
      labelA: row.label_a,
      labelB: row.label_b,
      confusionType: row.confusion_type,
      choiceGraded: row.choice_graded,
      choiceSuccess: row.choice_success,
      textSuccess: row.success_count,
      textGraded: row.graded_count,
      choiceP50LatencyMs: row.choice_p50 == null ? null : Math.round(Number(row.choice_p50)),
      stableItems: row.stable_items,
    })).map((entry) => ({ ...entry, recognizedNotRecalled: recognizedNotRecalled(entry) })),
    skills: skills.rows.map((row) => ({
      skillKey: row.stable_key,
      form: displayForm(row.canonical_form),
      meaning: row.meaning,
      choiceGraded: row.choice_graded,
      choiceSuccess: row.choice_success,
      textGraded: row.text_graded,
      textSuccess: row.text_success,
      stableItems: row.stable_items,
      itemCount: row.item_count,
    })).map((entry) => ({ ...entry, recognizedNotRecalled: recognizedNotRecalled(entry) })),
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
