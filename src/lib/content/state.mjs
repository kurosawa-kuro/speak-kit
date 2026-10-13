/** DB にある教材を、反映と書き出しで使う形で読む。学習の状態の欄は読まない。 */
export async function loadState(db) {
  const skills = (await db.query(
    `SELECT id, stable_key, canonical_form, meaning, category, intent, phase, tier, direction,
            concept_kind, status, review_source
     FROM skill_trainer.skill_concepts ORDER BY id`,
  )).rows
  const definitions = (await db.query(
    `SELECT exercise_key, version, training_mode, target_skill_id, target_capability,
            prompt_spec, reference_examples, accepted_variants, rubric, difficulty, modality, status
     FROM skill_trainer.exercise_definitions ORDER BY exercise_key, version`,
  )).rows
  const quizzes = (await db.query(
    `SELECT item_key, option_set_version, quiz_type, capability, prompt, options, correct_option_id,
            status, skill_id, probe_id, pair_id
     FROM skill_trainer.quiz_items ORDER BY item_key, option_set_version`,
  )).rows
  const pairs = (await db.query(
    `SELECT pair_id, label_a, label_b, skill_key_a, skill_key_b, key_a, direction_a, key_b, direction_b,
            confusion_type, source, created_at
     FROM skill_trainer.confusion_pairs ORDER BY created_at, pair_id`,
  )).rows
  const probes = (await db.query(
    `SELECT probe_id, pair_id, side, ordinal, prompt, expected_text
     FROM skill_trainer.confusion_probes ORDER BY pair_id, side, ordinal`,
  )).rows
  return { skills, definitions, quizzes, pairs, probes }
}

export function latestByKey(rows, keyField, versionField) {
  const latest = new Map()
  for (const row of rows) {
    const current = latest.get(row[keyField])
    if (!current || row[versionField] > current[versionField]) latest.set(row[keyField], row)
  }
  return latest
}

export async function learningCounts(db) {
  const tables = [
    "training_attempts",
    "quiz_attempts",
    "capability_evidence",
    "grading_observations",
    "weakness_diagnoses",
    "confusion_events",
    "learner_confusion_state",
    "conversation_sessions",
  ]
  const counts = {}
  for (const table of tables) {
    counts[table] = Number((await db.query(`SELECT count(*) AS n FROM skill_trainer.${table}`)).rows[0].n)
  }
  return counts
}
