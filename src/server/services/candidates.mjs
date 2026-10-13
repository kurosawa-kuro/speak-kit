import { deriveDefinitions, deriveSkillQuizzes } from "../content/derive.mjs"
import { expressionErrors } from "../content/schema.mjs"
import { insertDefinition, insertExpression } from "../content/write.mjs"
import { envelope, validationError } from "../http/envelope.mjs"
import { query, withTransaction } from "../db.mjs"

// 候補の承認は、YAML の表現と同じ形の表現を作り、YAML と同じ導出（deriveDefinitions）で練習問題を作る。
// 承認した表現は npm run data:export で YAML に取り込み、YAML を正本に戻す。

function text(request, key) {
  const value = request?.[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

async function nextCode(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('skill-trainer:expression-code', 0))")
  const found = await client.query(
    `SELECT coalesce(max(substring(exercise_key FROM '^P1-(\\d{3})-')::int), 0) AS n
     FROM skill_trainer.exercise_definitions WHERE exercise_key ~ '^P1-\\d{3}-'`,
  )
  return `P1-${String(found.rows[0].n + 1).padStart(3, "0")}`
}

function finalized(candidateId, candidate, decision) {
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

export async function reviewCandidate(operation, request) {
  const candidateId = request.candidate_id
  if (!Number.isSafeInteger(candidateId)) return validationError("candidate_id is required")
  const decision = text(request, "decision")
  const reviewedBy = text(request, "reviewed_by")
  const load = (db, lock) => db.query(
    `SELECT pattern, meaning, status, review_state, promoted_skill_id
     FROM skill_trainer.candidate_skills WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`,
    [candidateId],
  )
  const candidate = (await load({ query }, false)).rows[0]
  if (!candidate) return envelope(false, "not_found", {}, { message: "open candidate not found" })
  if (candidate.status !== "candidate") return finalized(candidateId, candidate, decision)
  if (decision === "rejected") {
    await query(
      `UPDATE skill_trainer.candidate_skills
       SET review_state = 'rejected', reviewed_at = NOW(), reviewed_by = $2, status = 'rejected'
       WHERE id = $1 AND status = 'candidate'`,
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
  const category = text(request, "category") || "OUTPUT"
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
  const expression = {
    key: stableKey,
    code: text(request, "code") ?? "P1-999",
    form: canonical,
    meaning: candidate.meaning || canonical,
    category,
    ...(text(request, "intent") ? { intent: text(request, "intent") } : {}),
    tier: text(request, "tier") || "TIER1",
    kind: text(request, "concept_kind") || "pattern",
    status: "active",
    example: { en: expectedReference, ja: exercisePrompt },
    ...(request.contrast_drill === true ? { contrast_drill: true } : {}),
  }
  const { category: _category, ...checked } = expression
  const errors = expressionErrors(checked, "候補")
  if (errors.length) return validationError(errors.join(" / "))
  const reviewSource = `owner candidate review by ${reviewedBy}`

  const result = await withTransaction(async (client) => {
    const locked = (await load(client, true)).rows[0]
    if (locked.status !== "candidate") return { replay: locked }
    let skillId
    let exerciseKey
    if (existing.rows[0]) {
      // 既にある表現へまとめるときは、例文を 1 つ足す（YAML の extra_examples と同じ形）。
      skillId = existing.rows[0].id
      exerciseKey = `CAND-${candidateId}`
      const [definition] = deriveDefinitions({ extra_examples: [{ key: exerciseKey, en: expectedReference, ja: exercisePrompt }] })
      await insertDefinition(client, definition, stableKey, 1, "active")
    } else {
      if (!text(request, "code")) expression.code = await nextCode(client)
      const derived = { definitions: deriveDefinitions(expression), quizzes: deriveSkillQuizzes(expression) }
      skillId = await insertExpression(client, expression, derived, reviewSource)
      exerciseKey = `${expression.code}-CR`
    }
    await client.query(
      `UPDATE skill_trainer.candidate_skills
       SET review_state = 'approved', reviewed_at = NOW(), reviewed_by = $2,
           status = 'promoted', promoted_skill_id = $3, promotion_snapshot = $4
       WHERE id = $1`,
      [candidateId, reviewedBy, skillId, JSON.stringify({
        stableKey,
        code: expression.code,
        canonicalForm: canonical,
        category,
        conceptKind: expression.kind,
        exerciseKey,
        exerciseVersion: 1,
      })],
    )
    return { skillId, exerciseKey }
  })
  if (result.replay) return finalized(candidateId, result.replay, decision)
  return envelope(true, "ok", {
    candidateId,
    reviewState: "approved",
    promoted: true,
    skillId: Number(result.skillId),
    exerciseKey: result.exerciseKey,
  }, null)
}
