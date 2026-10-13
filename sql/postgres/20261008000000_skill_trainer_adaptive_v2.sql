-- Adaptive Trainer v2. This migration is additive: every v1 table and row remains intact.
-- v1 is legacy input only; v2 derives learner state exclusively from immutable attempts,
-- append-only grading observations, and capability evidence.

CREATE TABLE IF NOT EXISTS skill_trainer.learning_policy_versions (
    policy_version      VARCHAR(80) PRIMARY KEY,
    status              VARCHAR(20) NOT NULL CHECK (status IN ('active', 'retired')),
    config              JSONB NOT NULL,
    effective_at        TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(config) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS learning_policy_versions_one_active_idx
  ON skill_trainer.learning_policy_versions ((status)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS skill_trainer.skill_concepts (
    id                  BIGSERIAL PRIMARY KEY,
    stable_key          VARCHAR(100) NOT NULL UNIQUE,
    canonical_form      VARCHAR(255) NOT NULL,
    meaning             TEXT NOT NULL,
    category            VARCHAR(20) NOT NULL
      CHECK (category IN ('OUTPUT', 'QUERY', 'TIME', 'ACTION', 'ERROR_HANDLING')),
    intent              VARCHAR(50),
    phase               SMALLINT NOT NULL DEFAULT 1 CHECK (phase IN (1, 2, 3)),
    tier                VARCHAR(20) NOT NULL DEFAULT 'CORE' CHECK (tier IN ('CORE', 'TIER1')),
    direction           VARCHAR(10) NOT NULL DEFAULT 'OUTPUT' CHECK (direction IN ('OUTPUT', 'INPUT')),
    concept_kind        VARCHAR(20) NOT NULL CHECK (concept_kind IN ('pattern', 'atomic_chunk')),
    status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    review_source       TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (length(stable_key) > 0),
    CHECK (length(canonical_form) > 0),
    CHECK (length(meaning) > 0)
);

CREATE TABLE IF NOT EXISTS skill_trainer.exercise_definitions (
    exercise_key        VARCHAR(100) NOT NULL,
    version             INTEGER NOT NULL CHECK (version > 0),
    training_mode       VARCHAR(30) NOT NULL
      CHECK (training_mode IN (
        'recognition', 'controlled_recall', 'slot_replacement', 'contrast_drill',
        'free_production', 'conversation_drill', 'spaced_retrieval'
      )),
    target_skill_id     BIGINT NOT NULL REFERENCES skill_trainer.skill_concepts(id),
    target_capability   VARCHAR(40) NOT NULL,
    prompt_spec         JSONB NOT NULL,
    reference_examples JSONB NOT NULL,
    accepted_variants   JSONB NOT NULL DEFAULT '[]'::jsonb,
    rubric              JSONB NOT NULL,
    difficulty          SMALLINT NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
    modality            VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (modality IN ('text', 'audio', 'conversation')),
    status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    content_hash        CHAR(64) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (exercise_key, version),
    CHECK (jsonb_typeof(prompt_spec) = 'object'),
    CHECK (jsonb_typeof(reference_examples) = 'array'),
    CHECK (jsonb_array_length(reference_examples) > 0),
    CHECK (jsonb_typeof(accepted_variants) = 'array'),
    CHECK (jsonb_typeof(rubric) = 'object'),
    CHECK (prompt_spec ? 'prompt'),
    CHECK (prompt_spec->>'prompt' NOT LIKE '%...%'),
    CHECK (prompt_spec->>'prompt' NOT LIKE '%{%' AND prompt_spec->>'prompt' NOT LIKE '%}%')
);

CREATE INDEX IF NOT EXISTS exercise_definitions_target_idx
  ON skill_trainer.exercise_definitions (target_skill_id, target_capability, training_mode, status);

CREATE TABLE IF NOT EXISTS skill_trainer.training_plans (
    plan_id             UUID PRIMARY KEY,
    learner_key         VARCHAR(80) NOT NULL DEFAULT 'default',
    planner_key         CHAR(64) NOT NULL UNIQUE,
    policy_version      VARCHAR(80) NOT NULL REFERENCES skill_trainer.learning_policy_versions(policy_version),
    input_snapshot      JSONB NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'completed', 'superseded')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    CHECK (jsonb_typeof(input_snapshot) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS training_plans_one_active_learner_idx
  ON skill_trainer.training_plans (learner_key) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS skill_trainer.weakness_diagnoses (
    diagnosis_id        UUID PRIMARY KEY,
    learner_key         VARCHAR(80) NOT NULL DEFAULT 'default',
    skill_id            BIGINT NOT NULL REFERENCES skill_trainer.skill_concepts(id),
    target_capability   VARCHAR(40) NOT NULL,
    type                VARCHAR(40) NOT NULL,
    status              VARCHAR(20) NOT NULL CHECK (status IN ('active', 'resolved')),
    severity            SMALLINT NOT NULL CHECK (severity BETWEEN 0 AND 100),
    confidence          SMALLINT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    evidence_refs       UUID[] NOT NULL,
    evidence_snapshot   JSONB NOT NULL,
    evidence_window     INTERVAL NOT NULL,
    evidence_count      INTEGER NOT NULL CHECK (evidence_count >= 0),
    diagnosed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_confirmed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,
    estimator_version   VARCHAR(80) NOT NULL,
    diagnosis_rule_version VARCHAR(80) NOT NULL,
    policy_version      VARCHAR(80) NOT NULL REFERENCES skill_trainer.learning_policy_versions(policy_version),
    CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
    CHECK ((status = 'active' AND resolved_at IS NULL) OR (status = 'resolved' AND resolved_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS weakness_diagnoses_one_active_idx
  ON skill_trainer.weakness_diagnoses (learner_key, skill_id, target_capability, type)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS skill_trainer.training_plan_items (
    plan_item_id        UUID PRIMARY KEY,
    plan_id             UUID NOT NULL REFERENCES skill_trainer.training_plans(plan_id),
    ordinal             SMALLINT NOT NULL CHECK (ordinal > 0),
    purpose             VARCHAR(10) NOT NULL CHECK (purpose IN ('Measure', 'Train', 'Verify')),
    skill_id            BIGINT NOT NULL REFERENCES skill_trainer.skill_concepts(id),
    target_capability   VARCHAR(40) NOT NULL,
    diagnosis_id        UUID REFERENCES skill_trainer.weakness_diagnoses(diagnosis_id),
    diagnosis_type      VARCHAR(40),
    exercise_key        VARCHAR(100) NOT NULL,
    exercise_version    INTEGER NOT NULL,
    training_mode       VARCHAR(30) NOT NULL,
    reason_code         VARCHAR(80) NOT NULL,
    selection_snapshot  JSONB NOT NULL,
    dose                INTEGER NOT NULL CHECK (dose > 0),
    stop_condition      JSONB NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'planned'
      CHECK (status IN ('planned', 'in_progress', 'awaiting_grade', 'completed', 'skipped')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    UNIQUE (plan_id, ordinal),
    FOREIGN KEY (exercise_key, exercise_version)
      REFERENCES skill_trainer.exercise_definitions(exercise_key, version),
    CHECK (jsonb_typeof(selection_snapshot) = 'object'),
    CHECK (jsonb_typeof(stop_condition) = 'object'),
    CHECK ((purpose = 'Measure' AND diagnosis_id IS NULL)
        OR (purpose IN ('Train', 'Verify') AND diagnosis_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS skill_trainer.rendered_exercises (
    exercise_instance_id UUID PRIMARY KEY,
    materialization_key CHAR(64) NOT NULL UNIQUE,
    plan_item_id        UUID REFERENCES skill_trainer.training_plan_items(plan_item_id),
    exercise_key        VARCHAR(100) NOT NULL,
    exercise_version    INTEGER NOT NULL,
    prompt              TEXT NOT NULL,
    expected_reference  TEXT NOT NULL,
    accepted_variants   JSONB NOT NULL,
    rubric_snapshot     JSONB NOT NULL,
    resolved_slots      JSONB NOT NULL DEFAULT '{}'::jsonb,
    modality            VARCHAR(20) NOT NULL,
    generator_version   VARCHAR(80) NOT NULL,
    policy_version      VARCHAR(80) NOT NULL REFERENCES skill_trainer.learning_policy_versions(policy_version),
    content_hash        CHAR(64) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (exercise_key, exercise_version)
      REFERENCES skill_trainer.exercise_definitions(exercise_key, version),
    CHECK (length(prompt) > 0),
    CHECK (length(expected_reference) > 0),
    CHECK (prompt NOT LIKE '%...%' AND expected_reference NOT LIKE '%...%'),
    CHECK (prompt NOT LIKE '%{%' AND prompt NOT LIKE '%}%'),
    CHECK (expected_reference NOT LIKE '%{%' AND expected_reference NOT LIKE '%}%'),
    CHECK (jsonb_typeof(accepted_variants) = 'array'),
    CHECK (jsonb_typeof(rubric_snapshot) = 'object'),
    CHECK (jsonb_typeof(resolved_slots) = 'object')
);

CREATE TABLE IF NOT EXISTS skill_trainer.training_attempts (
    attempt_id          UUID PRIMARY KEY,
    plan_item_id        UUID REFERENCES skill_trainer.training_plan_items(plan_item_id),
    exercise_instance_id UUID NOT NULL REFERENCES skill_trainer.rendered_exercises(exercise_instance_id),
    actual              TEXT NOT NULL,
    input_modality      VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (input_modality IN ('text', 'audio')),
    latency_ms          INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
    session_id          UUID,
    occurred_at         TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (length(actual) > 0)
);

CREATE TABLE IF NOT EXISTS skill_trainer.grading_observations (
    grading_id          UUID PRIMARY KEY,
    training_attempt_id UUID REFERENCES skill_trainer.training_attempts(attempt_id),
    conversation_turn_id BIGINT REFERENCES skill_trainer.conversation_turns(id),
    source              VARCHAR(30) NOT NULL CHECK (source IN ('deterministic', 'ai', 'human')),
    observer_version    VARCHAR(100) NOT NULL,
    idempotency_key     CHAR(64) NOT NULL UNIQUE,
    status              VARCHAR(20) NOT NULL CHECK (status IN ('graded', 'ungraded', 'invalid')),
    adopted_for_evidence BOOLEAN NOT NULL DEFAULT FALSE,
    rubric_version      VARCHAR(100) NOT NULL,
    dimension_results   JSONB NOT NULL,
    reason              TEXT,
    skill_candidates    JSONB NOT NULL DEFAULT '[]'::jsonb,
    error_candidates    JSONB NOT NULL DEFAULT '[]'::jsonb,
    model_reported_confidence DOUBLE PRECISION,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((training_attempt_id IS NOT NULL)::int + (conversation_turn_id IS NOT NULL)::int = 1),
    CHECK (jsonb_typeof(dimension_results) = 'object'),
    CHECK (jsonb_typeof(skill_candidates) = 'array'),
    CHECK (jsonb_typeof(error_candidates) = 'array'),
    CHECK (model_reported_confidence IS NULL OR model_reported_confidence BETWEEN 0 AND 1),
    CHECK (NOT adopted_for_evidence OR status = 'graded')
);

CREATE INDEX IF NOT EXISTS grading_observations_attempt_idx
  ON skill_trainer.grading_observations (training_attempt_id, created_at);

CREATE TABLE IF NOT EXISTS skill_trainer.capability_evidence (
    evidence_id         UUID PRIMARY KEY,
    training_attempt_id UUID REFERENCES skill_trainer.training_attempts(attempt_id),
    conversation_turn_id BIGINT REFERENCES skill_trainer.conversation_turns(id),
    grading_id          UUID NOT NULL REFERENCES skill_trainer.grading_observations(grading_id),
    skill_id            BIGINT NOT NULL REFERENCES skill_trainer.skill_concepts(id),
    capability          VARCHAR(40) NOT NULL,
    modality            VARCHAR(20) NOT NULL,
    outcome             VARCHAR(20) NOT NULL CHECK (outcome IN ('success', 'failure')),
    latency_ms          INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
    error_cause         VARCHAR(40),
    evidence_confidence SMALLINT NOT NULL CHECK (evidence_confidence BETWEEN 0 AND 100),
    derivation_version  VARCHAR(80) NOT NULL,
    policy_version      VARCHAR(80) NOT NULL REFERENCES skill_trainer.learning_policy_versions(policy_version),
    observed_at         TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (grading_id, skill_id, capability),
    CHECK ((training_attempt_id IS NOT NULL)::int + (conversation_turn_id IS NOT NULL)::int = 1)
);

CREATE INDEX IF NOT EXISTS capability_evidence_estimate_idx
  ON skill_trainer.capability_evidence (skill_id, capability, modality, observed_at DESC);

CREATE TABLE IF NOT EXISTS skill_trainer.learner_phase_gate_policies (
    phase               SMALLINT NOT NULL CHECK (phase IN (1, 2, 3)),
    version             VARCHAR(80) NOT NULL,
    requirements        JSONB NOT NULL,
    required_scenarios  JSONB NOT NULL DEFAULT '[]'::jsonb,
    effective_at        TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (phase, version),
    CHECK (jsonb_typeof(requirements) = 'array'),
    CHECK (jsonb_typeof(required_scenarios) = 'array')
);

CREATE TABLE IF NOT EXISTS skill_trainer.legacy_skill_migration_decisions (
    legacy_external_id  VARCHAR(50) PRIMARY KEY,
    legacy_skill_id     BIGINT NOT NULL REFERENCES skill_trainer.skills(id),
    legacy_english      TEXT NOT NULL,
    legacy_japanese     TEXT NOT NULL,
    target_skill_stable_key VARCHAR(100),
    target_canonical_form TEXT,
    exercise_key        VARCHAR(100),
    exercise_version    INTEGER,
    migration_decision  VARCHAR(30) NOT NULL
      CHECK (migration_decision IN ('owner_review_required', 'approved', 'retire', 'duplicate')),
    review_note         TEXT,
    reviewed_at         TIMESTAMPTZ,
    CHECK ((migration_decision = 'owner_review_required' AND reviewed_at IS NULL)
        OR migration_decision <> 'owner_review_required')
);

ALTER TABLE skill_trainer.candidate_skills
  ADD COLUMN IF NOT EXISTS review_state VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (review_state IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- Append-only facts and interpretations reject in-place mutation. Regrading appends a new row.
CREATE OR REPLACE FUNCTION skill_trainer.reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; append a new version/observation instead', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION skill_trainer.reject_versioned_content_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Operational status may move from active to retired. Versioned content itself
  -- must be replaced by a new identity/version, never edited in place.
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION '% content is immutable; insert a new version instead', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS learning_policy_versions_content_immutable
  ON skill_trainer.learning_policy_versions;
CREATE TRIGGER learning_policy_versions_content_immutable
  BEFORE UPDATE ON skill_trainer.learning_policy_versions
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_versioned_content_mutation();

DROP TRIGGER IF EXISTS learning_policy_versions_no_delete
  ON skill_trainer.learning_policy_versions;
CREATE TRIGGER learning_policy_versions_no_delete
  BEFORE DELETE ON skill_trainer.learning_policy_versions
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

DROP TRIGGER IF EXISTS exercise_definitions_content_immutable
  ON skill_trainer.exercise_definitions;
CREATE TRIGGER exercise_definitions_content_immutable
  BEFORE UPDATE ON skill_trainer.exercise_definitions
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_versioned_content_mutation();

DROP TRIGGER IF EXISTS exercise_definitions_no_delete
  ON skill_trainer.exercise_definitions;
CREATE TRIGGER exercise_definitions_no_delete
  BEFORE DELETE ON skill_trainer.exercise_definitions
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

DROP TRIGGER IF EXISTS learner_phase_gate_policies_append_only
  ON skill_trainer.learner_phase_gate_policies;
CREATE TRIGGER learner_phase_gate_policies_append_only
  BEFORE UPDATE OR DELETE ON skill_trainer.learner_phase_gate_policies
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

DROP TRIGGER IF EXISTS rendered_exercises_append_only ON skill_trainer.rendered_exercises;
CREATE TRIGGER rendered_exercises_append_only
  BEFORE UPDATE OR DELETE ON skill_trainer.rendered_exercises
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

DROP TRIGGER IF EXISTS training_attempts_append_only ON skill_trainer.training_attempts;
CREATE TRIGGER training_attempts_append_only
  BEFORE UPDATE OR DELETE ON skill_trainer.training_attempts
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

DROP TRIGGER IF EXISTS grading_observations_append_only ON skill_trainer.grading_observations;
CREATE TRIGGER grading_observations_append_only
  BEFORE UPDATE OR DELETE ON skill_trainer.grading_observations
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

DROP TRIGGER IF EXISTS capability_evidence_append_only ON skill_trainer.capability_evidence;
CREATE TRIGGER capability_evidence_append_only
  BEFORE UPDATE OR DELETE ON skill_trainer.capability_evidence
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

INSERT INTO skill_trainer.learning_policy_versions
  (policy_version, status, config, effective_at)
VALUES (
  'phase1-adaptive-v1',
  'active',
  '{
    "evidence_window_days": 30,
    "min_graded_count": 3,
    "target_success_rate": 0.8,
    "target_p50_latency_ms": 3000,
    "planner_budget": {"Measure": 2, "Train": 2, "Verify": 1},
    "dose": 1,
    "output_style": "POLITE_NEUTRAL"
  }'::jsonb,
  '2026-10-08T00:00:00+09:00'
) ON CONFLICT (policy_version) DO NOTHING;

INSERT INTO skill_trainer.skill_concepts
  (stable_key, canonical_form, meaning, category, intent, phase, tier, direction, concept_kind, review_source)
VALUES (
  'REQUEST_COULD_YOU',
  'Could you {verb_phrase}?',
  '相手に丁寧に行動を依頼する',
  'ACTION',
  'REQUEST',
  1,
  'CORE',
  'OUTPUT',
  'pattern',
  'owner-approved design feedback 2026-10-07'
) ON CONFLICT (stable_key) DO NOTHING;

INSERT INTO skill_trainer.exercise_definitions
  (exercise_key, version, training_mode, target_skill_id, target_capability, prompt_spec,
   reference_examples, accepted_variants, rubric, difficulty, modality, status, content_hash)
SELECT seed.exercise_key, 1, 'controlled_recall', sc.id, 'CONTROLLED_RECALL',
       jsonb_build_object('prompt', seed.prompt),
       jsonb_build_array(seed.reference),
       '[]'::jsonb,
       '{
         "rubric_version": "controlled-recall-v1",
         "required_dimensions": ["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]
       }'::jsonb,
       seed.difficulty,
       'text',
       'active',
       seed.content_hash
FROM skill_trainer.skill_concepts sc
CROSS JOIN (VALUES
  ('REQ-001', 'ファイルを送ってもらえますか？', 'Could you send me the file?', 1::smallint,
   '2d639d95f46cf5fb03cbb24e4204d558835fa3280685d52d220b8aa640831349'),
  ('REQ-002', 'この部分を確認してもらえますか？', 'Could you check this part?', 1::smallint,
   '204df16e555ee3159308c0d133d886ddebb6af2e633954dbc3356cdda78da985'),
  ('REQ-003', 'もう一度説明してもらえますか？', 'Could you explain that again?', 2::smallint,
   'da50ab6c43b75e91842ae0038af385e8b83c3dc63c90dc2c0f435a42154453e4')
) AS seed(exercise_key, prompt, reference, difficulty, content_hash)
WHERE sc.stable_key = 'REQUEST_COULD_YOU'
ON CONFLICT (exercise_key, version) DO NOTHING;

INSERT INTO skill_trainer.learner_phase_gate_policies
  (phase, version, requirements, required_scenarios, effective_at)
VALUES (
  1,
  'phase1-gate-draft-v1',
  '[
    {"capability":"CONTROLLED_RECALL","metric":"success_rate","window_days":30,"min_graded_count":3,"comparator":">=","threshold":0.8},
    {"capability":"CONTROLLED_RECALL","metric":"p50_latency_ms","window_days":30,"min_graded_count":3,"comparator":"<=","threshold":3000}
  ]'::jsonb,
  '[]'::jsonb,
  '2026-10-08T00:00:00+09:00'
) ON CONFLICT (phase, version) DO NOTHING;

INSERT INTO skill_trainer.legacy_skill_migration_decisions
  (legacy_external_id, legacy_skill_id, legacy_english, legacy_japanese, migration_decision, review_note)
SELECT s.external_id, s.id, s.canonical_pattern, s.meaning, 'owner_review_required',
       'Do not promote legacy attempts to v2 Evidence until Skill / Exercise mapping is approved.'
FROM skill_trainer.skills s
WHERE s.external_id IS NOT NULL
ON CONFLICT (legacy_external_id) DO NOTHING;

ALTER TABLE skill_trainer.learning_policy_versions OWNER TO job_control_api;
ALTER TABLE skill_trainer.skill_concepts OWNER TO job_control_api;
ALTER TABLE skill_trainer.exercise_definitions OWNER TO job_control_api;
ALTER TABLE skill_trainer.training_plans OWNER TO job_control_api;
ALTER TABLE skill_trainer.weakness_diagnoses OWNER TO job_control_api;
ALTER TABLE skill_trainer.training_plan_items OWNER TO job_control_api;
ALTER TABLE skill_trainer.rendered_exercises OWNER TO job_control_api;
ALTER TABLE skill_trainer.training_attempts OWNER TO job_control_api;
ALTER TABLE skill_trainer.grading_observations OWNER TO job_control_api;
ALTER TABLE skill_trainer.capability_evidence OWNER TO job_control_api;
ALTER TABLE skill_trainer.learner_phase_gate_policies OWNER TO job_control_api;
ALTER TABLE skill_trainer.legacy_skill_migration_decisions OWNER TO job_control_api;
ALTER FUNCTION skill_trainer.reject_append_only_mutation() OWNER TO job_control_api;
ALTER FUNCTION skill_trainer.reject_versioned_content_mutation() OWNER TO job_control_api;
