-- DB再設計 close-out: owner決定の Core をDBの不変条件として固定する。
-- Exercise -> Attempt -> Response -> Evaluation -> Evidence のidentityを全response modeで共有し、
-- Assessment Contractをversionedな独立契約としてExerciseから必須参照する。

CREATE OR REPLACE FUNCTION skill_trainer.rubric_dimensions_supported(rubric JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_typeof(rubric) = 'object'
     AND jsonb_typeof(rubric->'required_dimensions') = 'array'
     AND NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(rubric->'required_dimensions') AS dimension(value)
       WHERE jsonb_typeof(value) <> 'string'
          OR value #>> '{}' NOT IN (
            'communication', 'semantic', 'intent', 'form', 'policy', 'target_skill_usage'
          )
     );
$$;

CREATE OR REPLACE FUNCTION skill_trainer.assessment_dimensions_supported(values_json JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_typeof(values_json) = 'array'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(values_json) AS dimension(value)
       WHERE jsonb_typeof(value) <> 'string'
          OR value #>> '{}' NOT IN (
            'communication', 'semantic', 'intent', 'form', 'policy', 'target_skill_usage'
          )
     );
$$;

CREATE OR REPLACE FUNCTION skill_trainer.assessment_response_modes_supported(values_json JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_typeof(values_json) = 'array'
     AND jsonb_array_length(values_json) > 0
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(values_json) AS mode(value)
       WHERE jsonb_typeof(value) <> 'string'
          OR value #>> '{}' NOT IN ('free_text', 'choice', 'confusion_probe')
     );
$$;

CREATE TABLE skill_trainer.assessment_contracts (
  contract_key          VARCHAR(120) NOT NULL,
  version               INTEGER NOT NULL CHECK (version > 0),
  required_dimensions   JSONB NOT NULL,
  response_modes        JSONB NOT NULL,
  deterministic_policy  JSONB NOT NULL,
  ai_observation_schema JSONB,
  evidence_policy       VARCHAR(30) NOT NULL
    CHECK (evidence_policy IN ('versioned_reducer', 'no_evidence')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contract_key, version),
  CHECK (skill_trainer.assessment_dimensions_supported(required_dimensions)),
  CHECK (skill_trainer.assessment_response_modes_supported(response_modes)),
  CHECK (jsonb_typeof(deterministic_policy) = 'object'),
  CHECK (ai_observation_schema IS NULL OR jsonb_typeof(ai_observation_schema) = 'object')
);

CREATE TRIGGER assessment_contracts_append_only
  BEFORE UPDATE OR DELETE ON skill_trainer.assessment_contracts
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

INSERT INTO skill_trainer.assessment_contracts
  (contract_key, version, required_dimensions, response_modes, deterministic_policy,
   ai_observation_schema, evidence_policy)
SELECT
  'adaptive:' || ed.exercise_key,
  ed.version,
  ed.rubric->'required_dimensions',
  '["free_text"]'::jsonb,
  jsonb_build_object(
    'kind', 'normalized_exact_or_accepted_variant',
    'expected_reference', true,
    'accepted_variants', true
  ),
  jsonb_build_object(
    'meaning_match', 'boolean',
    'speech_act_match', 'boolean',
    'comprehensibility', 'enum',
    'target_pattern_status', 'enum',
    'issues', 'fact_array'
  ),
  'versioned_reducer'
FROM skill_trainer.exercise_definitions ed;

INSERT INTO skill_trainer.assessment_contracts
  (contract_key, version, required_dimensions, response_modes, deterministic_policy,
   ai_observation_schema, evidence_policy)
VALUES
  ('quiz-choice', 1, '[]'::jsonb, '["choice"]'::jsonb,
   '{"kind":"selected_option_equals_correct_option"}'::jsonb, NULL, 'no_evidence'),
  ('confusion-probe', 1, '[]'::jsonb, '["confusion_probe"]'::jsonb,
   '{"kind":"normalized_text_equals_expected_text"}'::jsonb, NULL, 'no_evidence');

DROP TRIGGER exercise_definitions_content_immutable ON skill_trainer.exercise_definitions;
ALTER TABLE skill_trainer.exercise_definitions
  ADD COLUMN assessment_contract_key VARCHAR(120),
  ADD COLUMN assessment_contract_version INTEGER;
UPDATE skill_trainer.exercise_definitions
SET assessment_contract_key = 'adaptive:' || exercise_key,
    assessment_contract_version = version;
ALTER TABLE skill_trainer.exercise_definitions
  ALTER COLUMN assessment_contract_key SET NOT NULL,
  ALTER COLUMN assessment_contract_version SET NOT NULL,
  ADD CONSTRAINT exercise_definitions_assessment_contract_fkey
    FOREIGN KEY (assessment_contract_key, assessment_contract_version)
    REFERENCES skill_trainer.assessment_contracts(contract_key, version),
  ADD CONSTRAINT exercise_definitions_rubric_dimensions_supported
    CHECK (skill_trainer.rubric_dimensions_supported(rubric));
CREATE TRIGGER exercise_definitions_content_immutable
  BEFORE UPDATE ON skill_trainer.exercise_definitions
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_versioned_content_mutation();

ALTER TABLE skill_trainer.rendered_exercises
  ADD CONSTRAINT rendered_exercises_rubric_dimensions_supported
  CHECK (skill_trainer.rubric_dimensions_supported(rubric_snapshot));

CREATE TABLE skill_trainer.exercises (
  exercise_id            UUID PRIMARY KEY,
  exercise_kind          VARCHAR(30) NOT NULL
    CHECK (exercise_kind IN ('rendered_free_text', 'quiz_choice', 'confusion_probe')),
  definition_key         VARCHAR(120) NOT NULL,
  definition_version     INTEGER NOT NULL CHECK (definition_version > 0),
  assessment_contract_key VARCHAR(120) NOT NULL,
  assessment_contract_version INTEGER NOT NULL,
  prompt_snapshot        TEXT NOT NULL CHECK (length(prompt_snapshot) > 0),
  target_skill_id        BIGINT REFERENCES skill_trainer.skill_concepts(id),
  target_capability      VARCHAR(40),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (assessment_contract_key, assessment_contract_version)
    REFERENCES skill_trainer.assessment_contracts(contract_key, version)
);
CREATE TRIGGER exercises_append_only
  BEFORE UPDATE OR DELETE ON skill_trainer.exercises
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

INSERT INTO skill_trainer.exercises
  (exercise_id, exercise_kind, definition_key, definition_version,
   assessment_contract_key, assessment_contract_version, prompt_snapshot,
   target_skill_id, target_capability, created_at)
SELECT re.exercise_instance_id, 'rendered_free_text', re.exercise_key, re.exercise_version,
       ed.assessment_contract_key, ed.assessment_contract_version, re.prompt,
       ed.target_skill_id, ed.target_capability, re.created_at
FROM skill_trainer.rendered_exercises re
JOIN skill_trainer.exercise_definitions ed
  ON ed.exercise_key = re.exercise_key AND ed.version = re.exercise_version;

ALTER TABLE skill_trainer.quiz_items
  ADD COLUMN exercise_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE skill_trainer.quiz_items
  ADD CONSTRAINT quiz_items_exercise_id_unique UNIQUE (exercise_id);
INSERT INTO skill_trainer.exercises
  (exercise_id, exercise_kind, definition_key, definition_version,
   assessment_contract_key, assessment_contract_version, prompt_snapshot,
   target_skill_id, target_capability, created_at)
SELECT exercise_id, 'quiz_choice', item_key, option_set_version,
       'quiz-choice', 1, prompt, skill_id, capability, created_at
FROM skill_trainer.quiz_items;

ALTER TABLE skill_trainer.confusion_probes
  ADD COLUMN exercise_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE skill_trainer.confusion_probes
  ADD CONSTRAINT confusion_probes_exercise_id_unique UNIQUE (exercise_id);
INSERT INTO skill_trainer.exercises
  (exercise_id, exercise_kind, definition_key, definition_version,
   assessment_contract_key, assessment_contract_version, prompt_snapshot,
   target_skill_id, target_capability, created_at)
SELECT probe.exercise_id, 'confusion_probe', 'probe:' || probe.probe_id::text, 1,
       'confusion-probe', 1, probe.prompt, NULL, 'CONTRAST_SELECTION', NOW()
FROM skill_trainer.confusion_probes probe;

CREATE OR REPLACE FUNCTION skill_trainer.register_rendered_exercise()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO skill_trainer.exercises
    (exercise_id, exercise_kind, definition_key, definition_version,
     assessment_contract_key, assessment_contract_version, prompt_snapshot,
     target_skill_id, target_capability, created_at)
  SELECT NEW.exercise_instance_id, 'rendered_free_text', NEW.exercise_key, NEW.exercise_version,
         ed.assessment_contract_key, ed.assessment_contract_version, NEW.prompt,
         ed.target_skill_id, ed.target_capability, NEW.created_at
  FROM skill_trainer.exercise_definitions ed
  WHERE ed.exercise_key = NEW.exercise_key AND ed.version = NEW.exercise_version;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rendered_exercises_register_core_exercise
  AFTER INSERT ON skill_trainer.rendered_exercises
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.register_rendered_exercise();

CREATE OR REPLACE FUNCTION skill_trainer.register_quiz_exercise()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO skill_trainer.exercises
    (exercise_id, exercise_kind, definition_key, definition_version,
     assessment_contract_key, assessment_contract_version, prompt_snapshot,
     target_skill_id, target_capability, created_at)
  VALUES (NEW.exercise_id, 'quiz_choice', NEW.item_key, NEW.option_set_version,
          'quiz-choice', 1, NEW.prompt, NEW.skill_id, NEW.capability, NEW.created_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER quiz_items_register_core_exercise
  AFTER INSERT ON skill_trainer.quiz_items
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.register_quiz_exercise();

CREATE OR REPLACE FUNCTION skill_trainer.register_confusion_probe_exercise()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO skill_trainer.exercises
    (exercise_id, exercise_kind, definition_key, definition_version,
     assessment_contract_key, assessment_contract_version, prompt_snapshot,
     target_skill_id, target_capability, created_at)
  VALUES (NEW.exercise_id, 'confusion_probe', 'probe:' || NEW.probe_id::text, 1,
          'confusion-probe', 1, NEW.prompt, NULL, 'CONTRAST_SELECTION', NOW());
  RETURN NEW;
END;
$$;
CREATE TRIGGER confusion_probes_register_core_exercise
  AFTER INSERT ON skill_trainer.confusion_probes
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.register_confusion_probe_exercise();

DROP TRIGGER training_attempts_append_only ON skill_trainer.training_attempts;
ALTER TABLE skill_trainer.training_attempts ADD COLUMN exercise_id UUID;
UPDATE skill_trainer.training_attempts
SET exercise_id = exercise_instance_id
WHERE response_mode = 'free_text';
UPDATE skill_trainer.training_attempts ta
SET exercise_id = qi.exercise_id
FROM skill_trainer.quiz_attempts qa
JOIN skill_trainer.quiz_items qi
  ON qi.item_key = qa.item_key AND qi.option_set_version = qa.option_set_version
WHERE qa.training_attempt_id = ta.attempt_id AND ta.response_mode = 'choice';
UPDATE skill_trainer.training_attempts ta
SET exercise_id = cp.exercise_id
FROM skill_trainer.confusion_events ce
JOIN skill_trainer.confusion_probes cp ON cp.probe_id = ce.probe_id
WHERE ce.attempt_id = ta.attempt_id AND ta.response_mode = 'confusion_probe';
ALTER TABLE skill_trainer.training_attempts
  ALTER COLUMN exercise_id SET NOT NULL,
  ADD CONSTRAINT training_attempts_exercise_id_fkey
    FOREIGN KEY (exercise_id) REFERENCES skill_trainer.exercises(exercise_id);
CREATE TRIGGER training_attempts_append_only
  BEFORE UPDATE OR DELETE ON skill_trainer.training_attempts
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

CREATE TABLE skill_trainer.attempt_responses (
  attempt_id              UUID PRIMARY KEY REFERENCES skill_trainer.training_attempts(attempt_id),
  response_schema_version VARCHAR(80) NOT NULL,
  payload                 JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO skill_trainer.attempt_responses
  (attempt_id, response_schema_version, payload, created_at)
SELECT attempt_id, response_mode || '-v1',
       jsonb_build_object('value', actual, 'responseMode', response_mode), created_at
FROM skill_trainer.training_attempts;
CREATE TRIGGER attempt_responses_append_only
  BEFORE UPDATE OR DELETE ON skill_trainer.attempt_responses
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION skill_trainer.register_attempt_response()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO skill_trainer.attempt_responses
    (attempt_id, response_schema_version, payload, created_at)
  VALUES (NEW.attempt_id, NEW.response_mode || '-v1',
          jsonb_build_object('value', NEW.actual, 'responseMode', NEW.response_mode), NEW.created_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER training_attempts_register_response
  AFTER INSERT ON skill_trainer.training_attempts
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.register_attempt_response();

-- non-free-textは決定論Evaluationを残してよいが、Evidence採用は不可。
CREATE OR REPLACE FUNCTION skill_trainer.reject_grading_for_non_free_text_attempt()
RETURNS trigger AS $$
DECLARE
  mode VARCHAR(20);
BEGIN
  IF NEW.training_attempt_id IS NOT NULL THEN
    SELECT response_mode INTO mode
    FROM skill_trainer.training_attempts WHERE attempt_id = NEW.training_attempt_id;
    IF mode <> 'free_text'
       AND (NEW.source <> 'deterministic' OR NEW.adopted_for_evidence OR NEW.status <> 'graded') THEN
      RAISE EXCEPTION
        'non-free-text Attempt permits only deterministic, graded, non-adopted Evaluation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION skill_trainer.validate_capability_evidence_source()
RETURNS trigger AS $$
DECLARE
  observation_attempt UUID;
  observation_turn BIGINT;
  observation_status VARCHAR(20);
  observation_adopted BOOLEAN;
  mode VARCHAR(20);
BEGIN
  SELECT training_attempt_id, conversation_turn_id, status, adopted_for_evidence
  INTO observation_attempt, observation_turn, observation_status, observation_adopted
  FROM skill_trainer.grading_observations WHERE grading_id = NEW.grading_id;

  IF observation_status <> 'graded' OR NOT observation_adopted THEN
    RAISE EXCEPTION 'CapabilityEvidence requires an adopted graded Evaluation';
  END IF;
  IF NEW.training_attempt_id IS NOT NULL THEN
    IF observation_attempt IS DISTINCT FROM NEW.training_attempt_id OR observation_turn IS NOT NULL THEN
      RAISE EXCEPTION 'CapabilityEvidence Attempt must equal its Evaluation Attempt';
    END IF;
    SELECT response_mode INTO mode
    FROM skill_trainer.training_attempts WHERE attempt_id = NEW.training_attempt_id;
    IF mode <> 'free_text' THEN
      RAISE EXCEPTION 'only free_text Attempt may derive CapabilityEvidence';
    END IF;
  ELSE
    IF observation_turn IS DISTINCT FROM NEW.conversation_turn_id OR observation_attempt IS NOT NULL THEN
      RAISE EXCEPTION 'CapabilityEvidence Turn must equal its Evaluation Turn';
    END IF;
  END IF;
  IF btrim(NEW.derivation_version) = '' THEN
    RAISE EXCEPTION 'CapabilityEvidence requires a versioned reducer';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER capability_evidence_validate_source
  BEFORE INSERT ON skill_trainer.capability_evidence
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.validate_capability_evidence_source();

CREATE VIEW skill_trainer.evaluations AS
SELECT grading_id AS evaluation_id,
       training_attempt_id AS attempt_id,
       conversation_turn_id,
       source AS evaluator_type,
       observer_version AS evaluator_version,
       status,
       adopted_for_evidence,
       rubric_version AS assessment_contract_version,
       dimension_results AS result,
       reason,
       created_at
FROM skill_trainer.grading_observations;

ALTER TABLE skill_trainer.assessment_contracts OWNER TO job_control_api;
ALTER TABLE skill_trainer.exercises OWNER TO job_control_api;
ALTER TABLE skill_trainer.attempt_responses OWNER TO job_control_api;
ALTER VIEW skill_trainer.evaluations OWNER TO job_control_api;
