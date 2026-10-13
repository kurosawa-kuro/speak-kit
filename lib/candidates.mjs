import { envelope, validationError } from "./envelope.mjs"
import { hashParts } from "./hash.mjs"
import { query } from "./db.mjs"

function text(request, key) {
  const value = request?.[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export async function reviewCandidate(request) {
  const candidateId = Number(request.candidate_id)
  if (!Number.isInteger(candidateId)) return validationError("candidate_id is required")
  const decision = text(request, "decision")
  const reviewedBy = text(request, "reviewed_by")
  const found = await query(
    `SELECT pattern, meaning, status, review_state, promoted_skill_id
     FROM skill_trainer.candidate_skills WHERE id = $1`,
    [candidateId],
  )
  const candidate = found.rows[0]
  if (!candidate) return envelope(false, "not_found", {}, { message: "open candidate not found" })
  if (candidate.status !== "candidate") {
    if (candidate.review_state !== decision) {
      return envelope(false, "idempotency_conflict", {}, { message: "candidate was already finalized with a different decision" })
    }
    return envelope(true, "idempotent_replay", {
      candidateId,
      reviewState: candidate.review_state,
      promoted: candidate.promoted_skill_id != null,
      skillId: candidate.promoted_skill_id,
    }, null)
  }
  if (decision === "rejected") {
    await query(
      `UPDATE skill_trainer.candidate_skills
       SET review_state = 'rejected', reviewed_at = NOW(), reviewed_by = $2, status = 'rejected'
       WHERE id = $1`,
      [candidateId, reviewedBy],
    )
    return envelope(true, "ok", { candidateId, reviewState: "rejected", promoted: false }, null)
  }
  const stableKey = text(request, "stable_key")
  if (!stableKey) return validationError("stable_key is required for approval")
  const exercisePrompt = text(request, "exercise_prompt")
  const expectedReference = text(request, "expected_reference")
  if (!exercisePrompt) return validationError("exercise_prompt is required for approval")
  if (!expectedReference) return validationError("expected_reference is required for approval")
  if ([exercisePrompt, expectedReference].some((value) => value.includes("{") || value.includes("}"))) {
    return validationError("approved Exercise must not contain unresolved placeholders")
  }
  const category = text(request, "category") || "OUTPUT"
  const conceptKind = text(request, "concept_kind") || "pattern"
  if (!["pattern", "atomic_chunk"].includes(conceptKind)) return validationError("invalid concept_kind")
  const allowed = await query(
    `SELECT EXISTS (
       SELECT 1 FROM skill_trainer.domain_categories dc
       JOIN skill_trainer.domains d ON d.id = dc.domain_id
       WHERE d.code = 'english_conversation' AND dc.category_code = $1
     ) AS ok`,
    [category],
  )
  if (!allowed.rows[0].ok) return validationError("invalid category for domain")
  const existing = await query(
    `SELECT sc.id, d.code FROM skill_trainer.skill_concepts sc
     JOIN skill_trainer.domains d ON d.id = sc.domain_id
     WHERE sc.stable_key = $1`,
    [stableKey],
  )
  if (existing.rows[0] && existing.rows[0].code !== "english_conversation") {
    return validationError("stable_key belongs to another domain")
  }
  if (existing.rows[0] && request.merge_existing_skill !== true) {
    return envelope(false, "duplicate_requires_explicit_merge", {}, {
      message: "stable_key already exists; set merge_existing_skill=true after owner comparison",
    })
  }
  const canonical = text(request, "canonical_form") || candidate.pattern
  const meaning = candidate.meaning || canonical
  let skillId = existing.rows[0]?.id
  if (!skillId) {
    const inserted = await query(
      `INSERT INTO skill_trainer.skill_concepts
         (stable_key, canonical_form, meaning, category, intent, phase, tier, direction,
          concept_kind, review_source, domain_id)
       VALUES ($1, $2, $3, $4, $5, 1, 'TIER1', 'OUTPUT', $6, $7,
         (SELECT id FROM skill_trainer.domains WHERE code = 'english_conversation'))
       RETURNING id`,
      [stableKey, canonical, meaning, category, text(request, "intent"), conceptKind, `owner candidate review by ${reviewedBy}`],
    )
    skillId = inserted.rows[0].id
  }
  const exerciseKey = `CANDIDATE-${candidateId}-CR`
  await query(
    `INSERT INTO skill_trainer.exercise_definitions
       (exercise_key, version, training_mode, target_skill_id, target_capability,
        prompt_spec, reference_examples, accepted_variants, rubric, difficulty,
        modality, status, content_hash, assessment_contract_key, assessment_contract_version)
     VALUES ($1, 1, 'controlled_recall', $2, 'CONTROLLED_RECALL',
             jsonb_build_object('prompt', $3::text), jsonb_build_array($4::text), '[]'::jsonb,
             '{"rubric_version":"controlled-recall-v2","required_dimensions":["communication","semantic","intent","form","policy","target_skill_usage"]}'::jsonb,
             2, 'text', 'active', $5, 'adaptive:REQ-001', 1)
     ON CONFLICT (exercise_key, version) DO NOTHING`,
    [exerciseKey, skillId, exercisePrompt, expectedReference, hashParts([exerciseKey, exercisePrompt, expectedReference, "controlled-recall-v2"])],
  )
  await query(
    `UPDATE skill_trainer.candidate_skills
     SET review_state = 'approved', reviewed_at = NOW(), reviewed_by = $2,
         status = 'promoted', promoted_skill_id = $3, promotion_snapshot = $4
     WHERE id = $1`,
    [candidateId, reviewedBy, skillId, JSON.stringify({
      stableKey,
      canonicalForm: canonical,
      category,
      conceptKind,
      exerciseKey,
      exerciseVersion: 1,
    })],
  )
  return envelope(true, "ok", {
    candidateId,
    reviewState: "approved",
    promoted: true,
    skillId,
    exerciseKey,
  }, null)
}
