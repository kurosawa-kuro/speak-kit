import { randomUUID } from "node:crypto"
import { hashParts } from "./hash.mjs"
import { estimateJson } from "./learning.mjs"

const GENERATOR = "exercise-materializer-v1"

function resetAt(domainId) {
  return `COALESCE((SELECT max(requested_at) FROM skill_trainer.review_resets
    WHERE learner_key = 'default' AND domain_id = ${Number(domainId)}), '-infinity'::timestamptz)`
}

function mastered(domainId) {
  const reset = resetAt(domainId)
  return `EXISTS (
    SELECT 1 FROM skill_trainer.capability_evidence mastered
    JOIN skill_trainer.training_attempts mastered_attempt ON mastered_attempt.attempt_id = mastered.training_attempt_id
    JOIN skill_trainer.rendered_exercises mastered_render ON mastered_render.exercise_instance_id = mastered_attempt.exercise_instance_id
    WHERE mastered_render.prompt = ed.prompt_spec->>'prompt'
      AND mastered.outcome = 'success' AND mastered.observed_at > ${reset}
      AND NOT EXISTS (
        SELECT 1 FROM skill_trainer.capability_evidence relapsed
        JOIN skill_trainer.training_attempts relapsed_attempt ON relapsed_attempt.attempt_id = relapsed.training_attempt_id
        JOIN skill_trainer.rendered_exercises relapsed_render ON relapsed_render.exercise_instance_id = relapsed_attempt.exercise_instance_id
        WHERE relapsed_render.prompt = mastered_render.prompt
          AND relapsed.outcome = 'failure' AND relapsed.observed_at > mastered.observed_at
      )
  )`
}

const CANDIDATE = `SELECT sc.id AS skill_id, sc.stable_key, sc.canonical_form, sc.meaning, sc.category,
        ed.target_capability, wd.diagnosis_id, wd.type AS diagnosis_type, wd.severity,
        ed.exercise_key, ed.version, ed.training_mode, ed.prompt_spec->>'prompt' AS prompt,
        ed.reference_examples->>0 AS reference, ed.accepted_variants, ed.rubric, ed.modality,
        count(ce.evidence_id)::bigint AS graded_count,
        count(ce.evidence_id) FILTER (WHERE ce.outcome = 'success')::bigint AS success_count,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY ce.latency_ms)
          FILTER (WHERE ce.latency_ms IS NOT NULL))::double precision AS p50_latency_ms,
        max(ce.observed_at) AS last_observed_at
 FROM skill_trainer.weakness_diagnoses wd
 JOIN skill_trainer.skill_concepts sc ON sc.id = wd.skill_id
 JOIN LATERAL (
   SELECT d.* FROM skill_trainer.exercise_definitions d
   WHERE d.target_skill_id = wd.skill_id AND d.target_capability = wd.target_capability
     AND d.status = 'active'
   ORDER BY d.version DESC, d.exercise_key LIMIT 1
 ) ed ON TRUE
 LEFT JOIN skill_trainer.effective_capability_evidence ce
   ON ce.skill_id = wd.skill_id AND ce.capability = wd.target_capability
  AND ce.observed_at >= NOW() - make_interval(days => $1)
 WHERE wd.learner_key = 'default' AND wd.status = $2
   AND sc.domain_id = $6
   AND ($3::boolean OR wd.type <> 'RETENTION')
   AND ($4::boolean OR wd.type = 'RETENTION')
   AND ($5::boolean OR NOT EXISTS (
     SELECT 1 FROM skill_trainer.training_plan_items done
     WHERE done.diagnosis_id = wd.diagnosis_id AND done.purpose = 'Verify'
       AND done.status = 'completed'
   ))
 GROUP BY sc.id, sc.stable_key, sc.canonical_form, sc.meaning, sc.category,
          ed.target_capability, wd.diagnosis_id, wd.type, wd.severity,
          ed.exercise_key, ed.version, ed.training_mode, ed.prompt_spec,
          ed.reference_examples, ed.accepted_variants, ed.rubric, ed.modality,
          wd.diagnosed_at, wd.resolved_at
 ORDER BY wd.severity DESC, COALESCE(wd.resolved_at, wd.diagnosed_at), sc.stable_key`

function estimateOf(row, capability, windowDays) {
  const graded = Number(row.graded_count || 0)
  const success = Number(row.success_count || 0)
  return estimateJson({
    gradedCount: graded,
    successCount: success,
    successRate: graded > 0 ? success / graded : null,
    p50LatencyMs: row.p50_latency_ms == null ? null : Math.round(Number(row.p50_latency_ms)),
    lastObservedAt: row.last_observed_at || null,
    confidence: Math.min(graded * 20, 100),
  }, capability, windowDays)
}

export async function createAdaptivePlan(client, domainId, policyVersion, config) {
  const windowDays = Number(config.evidence_window_days || 30)
  const raw = config.planner_budget || {}
  const budget = { Measure: Number(raw.Measure ?? 2), Train: Number(raw.Train ?? 2), Verify: Number(raw.Verify ?? 1) }
  const minGraded = Number(config.min_graded_count || 3)
  const train = await client.query(CANDIDATE, [windowDays, "active", false, true, true, domainId])
  const selected = train.rows.slice(0, Number(budget.Train || 0)).map((row) => ({ purpose: "Train", row }))
  const verify = await client.query(CANDIDATE, [windowDays, "active", true, false, true, domainId])
  const resolved = await client.query(CANDIDATE, [windowDays, "resolved", true, true, false, domainId])
  for (const row of [...verify.rows, ...resolved.rows].slice(0, Number(budget.Verify || 0))) {
    selected.push({ purpose: "Verify", row })
  }
  const target = Number(budget.Measure || 0) + Number(budget.Train || 0) + Number(budget.Verify || 0)
  const measure = await client.query(
    `WITH ranked AS (
       SELECT sc.id AS skill_id, sc.stable_key, sc.canonical_form, sc.meaning, sc.category,
              ed.target_capability, NULL::uuid AS diagnosis_id, NULL::text AS diagnosis_type,
              NULL::smallint AS severity, ed.exercise_key, ed.version, ed.training_mode,
              ed.prompt_spec->>'prompt' AS prompt, ed.reference_examples->>0 AS reference,
              ed.accepted_variants, ed.rubric, ed.modality,
              count(ce.evidence_id)::bigint AS graded_count,
              count(ce.evidence_id) FILTER (WHERE ce.outcome = 'success')::bigint AS success_count,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY ce.latency_ms)
                FILTER (WHERE ce.latency_ms IS NOT NULL))::double precision AS p50_latency_ms,
              max(ce.observed_at) AS last_observed_at,
              row_number() OVER (
                PARTITION BY ed.target_capability
                ORDER BY count(ce.evidence_id), max(ce.observed_at) NULLS FIRST, sc.stable_key
              ) AS capability_rank
       FROM skill_trainer.exercise_definitions ed
       JOIN skill_trainer.skill_concepts sc ON sc.id = ed.target_skill_id
       LEFT JOIN skill_trainer.effective_capability_evidence ce
         ON ce.skill_id = sc.id AND ce.capability = ed.target_capability
        AND ce.observed_at >= NOW() - make_interval(days => $1)
       WHERE ed.status = 'active' AND sc.status = 'active' AND sc.phase = 1
         AND sc.domain_id = $3
         AND ed.training_mode <> 'spaced_retrieval'
         AND NOT ${mastered(domainId)}
         AND NOT EXISTS (
           SELECT 1 FROM skill_trainer.weakness_diagnoses wd
           WHERE wd.learner_key = 'default' AND wd.skill_id = sc.id
             AND wd.target_capability = ed.target_capability AND wd.status = 'active'
         )
       GROUP BY sc.id, sc.stable_key, sc.canonical_form, sc.meaning, sc.category,
                ed.target_capability, ed.exercise_key, ed.version, ed.training_mode,
                ed.prompt_spec, ed.reference_examples, ed.accepted_variants, ed.rubric, ed.modality
     )
     SELECT * FROM ranked
     ORDER BY CASE WHEN capability_rank = 1 THEN 0 ELSE 1 END,
              graded_count, last_observed_at NULLS FIRST, stable_key
     LIMIT $2`,
    [windowDays, target, domainId],
  )
  const chosen = new Set(selected.map((item) => `${item.row.skill_id}:${item.row.target_capability}`))
  for (const row of measure.rows) {
    if (selected.length >= target) break
    const key = `${row.skill_id}:${row.target_capability}`
    if (chosen.has(key)) continue
    chosen.add(key)
    selected.push({ purpose: "Measure", row })
  }
  if (!selected.length) return null
  const planId = randomUUID()
  const plannerKey = hashParts([
    policyVersion,
    new Date().toISOString().slice(0, 10),
    selected.map((item) => `${item.purpose}:${item.row.stable_key}:${item.row.exercise_key}`).join("|"),
  ])
  await client.query(
    `INSERT INTO skill_trainer.training_plans
       (plan_id, learner_key, planner_key, policy_version, input_snapshot, status, domain_id)
     VALUES ($1, 'default', $2, $3, $4, 'active', $5)`,
    [planId, plannerKey, policyVersion, JSON.stringify({
      plannerBudget: budget,
      selectedCount: selected.length,
      selectionRule: "diagnosis_then_verification_then_evidence_gap_v2",
      unusedPurposeCapacityReassignedTo: "Measure",
    }), domainId],
  )
  let ordinal = 1
  for (const item of selected) {
    const row = item.row
    if (!row.prompt || !row.reference) continue
    const planItemId = randomUUID()
    const instanceId = randomUUID()
    const estimate = estimateOf(row, row.target_capability, windowDays)
    const reason = item.purpose === "Train"
      ? `diagnosis:${row.diagnosis_type || "unknown"}`
      : item.purpose === "Verify" && row.diagnosis_type === "RETENTION"
        ? `retention_due:${row.target_capability}`
        : item.purpose === "Verify"
          ? `verify:${row.diagnosis_type || "resolved"}`
          : estimate.gradedCount < minGraded
            ? "insufficient_evidence"
            : "scheduled_measurement"
    await client.query(
      `INSERT INTO skill_trainer.training_plan_items
         (plan_item_id, plan_id, ordinal, purpose, skill_id, target_capability,
          diagnosis_id, diagnosis_type, exercise_key, exercise_version, training_mode,
          reason_code, selection_snapshot, dose, stop_condition, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::int, jsonb_build_object('graded_attempts', $14::int), 'planned')`,
      [
        planItemId, planId, ordinal, item.purpose, row.skill_id, row.target_capability,
        row.diagnosis_id, row.diagnosis_type, row.exercise_key, row.version, row.training_mode,
        reason, JSON.stringify({
          skill: { skillKey: row.stable_key, canonicalForm: row.canonical_form, meaning: row.meaning, category: row.category },
          estimate,
          diagnosisSeverity: row.severity,
          target: {
            successRate: Number(config.target_success_rate || 0.8),
            p50LatencyMs: Number(config.target_p50_latency_ms || 3000),
            minGradedCount: minGraded,
          },
          plannerBudget: budget,
          selectedPurpose: item.purpose,
        }),
        Number(config.dose || 1),
      ],
    )
    ordinal += 1
    await client.query(
      `INSERT INTO skill_trainer.rendered_exercises
         (exercise_instance_id, materialization_key, plan_item_id, exercise_key, exercise_version,
          prompt, expected_reference, accepted_variants, rubric_snapshot, resolved_slots,
          modality, generator_version, policy_version, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, $10, $11, $12, $13)`,
      [
        instanceId,
        hashParts([planItemId, row.exercise_key, String(row.version)]),
        planItemId,
        row.exercise_key,
        row.version,
        row.prompt,
        row.reference,
        JSON.stringify(row.accepted_variants || []),
        JSON.stringify(row.rubric || {}),
        row.modality,
        GENERATOR,
        policyVersion,
        hashParts([row.prompt, row.reference, JSON.stringify(row.rubric || {}), GENERATOR, policyVersion]),
      ],
    )
  }
  return planId
}
