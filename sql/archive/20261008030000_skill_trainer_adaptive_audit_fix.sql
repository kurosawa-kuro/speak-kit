-- Adaptive Trainer v2 close-loop audit fixes.
--
-- Evidence remains append-only, but more than one versioned interpretation may
-- now be eligible for the same immutable source.  The view below is the
-- versioned selection projection consumed by estimates, diagnoses and plans.

DROP INDEX IF EXISTS skill_trainer.grading_observations_one_adopted_attempt_idx;
DROP INDEX IF EXISTS skill_trainer.capability_evidence_one_attempt_capability_idx;

CREATE OR REPLACE VIEW skill_trainer.effective_capability_evidence AS
WITH ranked AS (
  SELECT ce.*,
         go.source AS observer_source,
         go.observer_version,
         row_number() OVER (
           PARTITION BY
             COALESCE(
               'attempt:' || ce.training_attempt_id::text,
               'turn:' || ce.conversation_turn_id::text
             ),
             ce.skill_id,
             ce.capability
           ORDER BY
             CASE go.source WHEN 'human' THEN 3 WHEN 'deterministic' THEN 2 ELSE 1 END DESC,
             go.created_at DESC,
             ce.created_at DESC,
             ce.evidence_id DESC
         ) AS selection_rank
  FROM skill_trainer.capability_evidence ce
  JOIN skill_trainer.grading_observations go ON go.grading_id = ce.grading_id
  WHERE go.status = 'graded' AND go.adopted_for_evidence = TRUE
)
SELECT evidence_id, training_attempt_id, conversation_turn_id, grading_id,
       skill_id, capability, modality, outcome, latency_ms, error_cause,
       evidence_confidence, derivation_version, policy_version, observed_at,
       created_at, observer_source, observer_version
FROM ranked
WHERE selection_rank = 1;

ALTER VIEW skill_trainer.effective_capability_evidence OWNER TO job_control_api;

ALTER TABLE skill_trainer.conversation_sessions
  ADD COLUMN IF NOT EXISTS candidate_extraction_count INTEGER NOT NULL DEFAULT 0
    CHECK (candidate_extraction_count >= 0);

-- Placeholder validation belongs at the data boundary, not only in the UI or
-- seed generator.  A/B is rejected only when both occur as standalone marker
-- tokens (or the whole value is one marker), avoiding false positives such as
-- an ordinary sentence beginning with the article "A".
CREATE OR REPLACE FUNCTION skill_trainer.has_unresolved_placeholder(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT value IS NULL
      OR btrim(value) = ''
      OR value ~ '(\.\.\.|…|〜|～|\{|\})'
      OR btrim(value) ~ '^(A|B)$'
      OR (
        value ~ '(^|[^A-Za-z])A([^A-Za-z]|$)'
        AND value ~ '(^|[^A-Za-z])B([^A-Za-z]|$)'
      );
$$;

ALTER FUNCTION skill_trainer.has_unresolved_placeholder(TEXT) OWNER TO job_control_api;

CREATE OR REPLACE FUNCTION skill_trainer.has_unresolved_placeholder(values_json JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_typeof(values_json) <> 'array'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(values_json) AS reference(value)
        WHERE skill_trainer.has_unresolved_placeholder(reference.value)
      );
$$;

ALTER FUNCTION skill_trainer.has_unresolved_placeholder(JSONB) OWNER TO job_control_api;

ALTER TABLE skill_trainer.exercise_definitions
  DROP CONSTRAINT IF EXISTS exercise_definitions_prompt_resolved,
  DROP CONSTRAINT IF EXISTS exercise_definitions_references_resolved;

ALTER TABLE skill_trainer.exercise_definitions
  ADD CONSTRAINT exercise_definitions_prompt_resolved
    CHECK (NOT skill_trainer.has_unresolved_placeholder(prompt_spec->>'prompt')) NOT VALID,
  ADD CONSTRAINT exercise_definitions_references_resolved
    CHECK (NOT skill_trainer.has_unresolved_placeholder(reference_examples)) NOT VALID;

ALTER TABLE skill_trainer.exercise_definitions
  VALIDATE CONSTRAINT exercise_definitions_prompt_resolved;
ALTER TABLE skill_trainer.exercise_definitions
  VALIDATE CONSTRAINT exercise_definitions_references_resolved;

ALTER TABLE skill_trainer.rendered_exercises
  DROP CONSTRAINT IF EXISTS rendered_exercises_content_resolved;
ALTER TABLE skill_trainer.rendered_exercises
  ADD CONSTRAINT rendered_exercises_content_resolved
    CHECK (
      NOT skill_trainer.has_unresolved_placeholder(prompt)
      AND NOT skill_trainer.has_unresolved_placeholder(expected_reference)
    ) NOT VALID;
ALTER TABLE skill_trainer.rendered_exercises
  VALIDATE CONSTRAINT rendered_exercises_content_resolved;

-- A learner cannot pass the whole phase by repeating one Skill.  v2 preserves
-- the original metric thresholds and adds minimum cross-Skill coverage.
INSERT INTO skill_trainer.learner_phase_gate_policies
  (phase, version, requirements, required_scenarios, effective_at)
VALUES (
  1, 'phase1-gate-v2',
  '[
    {"capability":"CONTROLLED_RECALL","metric":"success_rate","window_days":30,"min_graded_count":10,"min_distinct_skills":10,"comparator":">=","threshold":0.8},
    {"capability":"CONTROLLED_RECALL","metric":"p50_latency_ms","window_days":30,"min_graded_count":10,"min_distinct_skills":10,"comparator":"<=","threshold":3000},
    {"capability":"RECOGNITION","metric":"success_rate","window_days":30,"min_graded_count":10,"min_distinct_skills":10,"comparator":">=","threshold":0.85},
    {"capability":"SLOT_REPLACEMENT","metric":"success_rate","window_days":30,"min_graded_count":5,"min_distinct_skills":5,"comparator":">=","threshold":0.8},
    {"capability":"CONTRAST_SELECTION","metric":"success_rate","window_days":30,"min_graded_count":5,"min_distinct_skills":5,"comparator":">=","threshold":0.8},
    {"capability":"FREE_PRODUCTION","metric":"success_rate","window_days":30,"min_graded_count":5,"min_distinct_skills":5,"comparator":">=","threshold":0.7},
    {"capability":"CONVERSATION_USAGE","metric":"success_rate","window_days":30,"min_graded_count":5,"min_distinct_skills":5,"comparator":">=","threshold":0.7},
    {"capability":"RETENTION_7D","metric":"success_rate","window_days":30,"min_graded_count":5,"min_distinct_skills":5,"comparator":">=","threshold":0.8}
  ]'::jsonb,
  '[
    {"scenario":"teacher","min_duration_seconds":600,"min_self_questions":5},
    {"scenario":"learner","min_duration_seconds":600,"min_self_questions":5},
    {"scenario":"free_talk","min_duration_seconds":600,"min_self_questions":5}
  ]'::jsonb,
  NOW()
) ON CONFLICT (phase, version) DO NOTHING;

ALTER TABLE skill_trainer.conversation_sessions OWNER TO job_control_api;
