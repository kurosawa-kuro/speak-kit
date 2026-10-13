import { envelope, validationError } from "./envelope.mjs"
import { query } from "./db.mjs"

const MODES = new Set([
  "controlled_recall",
  "recognition",
  "slot_replacement",
  "contrast_drill",
  "free_production",
])

function text(request, key) {
  const value = request?.[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "")
}

export async function getPractice(request) {
  if (!isUuid(text(request, "practice_id"))) return validationError("practice_id must be a UUID")
  const mode = text(request, "training_mode")
  if (!mode) return validationError("training_mode is required")
  if (!MODES.has(mode)) return validationError("unsupported free-practice training_mode")
  const found = await query(
    `SELECT ed.exercise_key, ed.version, ed.training_mode, ed.modality,
            ed.prompt_spec->>'prompt' AS prompt, ed.reference_examples->>0 AS reference,
            ed.accepted_variants, ed.rubric->'required_dimensions' AS required_dimensions,
            sc.stable_key, sc.canonical_form, sc.meaning, sc.category
     FROM skill_trainer.exercise_definitions ed
     JOIN skill_trainer.skill_concepts sc ON sc.id = ed.target_skill_id
     WHERE ed.status = 'active' AND sc.status = 'active' AND ed.training_mode = $1
       AND sc.domain_id = (SELECT id FROM skill_trainer.domains WHERE code = 'english_conversation')
     ORDER BY random()
     LIMIT 1`,
    [mode],
  )
  const row = found.rows[0]
  if (!row) return validationError("unknown domain_code")
  return envelope(
    true,
    "ok",
    {
      skill: {
        skillKey: row.stable_key,
        canonicalForm: row.canonical_form,
        meaning: row.meaning,
        category: row.category,
      },
      exercise: {
        exerciseKey: row.exercise_key,
        exerciseVersion: row.version,
        prompt: row.prompt,
        expectedReference: row.reference || "",
        acceptedVariants: row.accepted_variants || [],
        requiredDimensions: row.required_dimensions || [],
        modality: row.modality,
        trainingMode: row.training_mode,
      },
    },
    null,
  )
}
