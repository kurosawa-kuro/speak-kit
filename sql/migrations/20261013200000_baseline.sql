-- speak-kit の DB の土台（baseline）。2026-10-13 に、参照元から写した 29 本の migration（sql/archive/）を
-- 1 本にまとめ直した。教材は入れない（data/ の YAML から npm run data:sync -- --apply で入れる）。
-- 適用は scripts/db-apply.sh <DB 名>。適用の記録は skill_trainer.schema_migrations に残る。

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;

CREATE SCHEMA skill_trainer;

--
-- Name: assessment_dimensions_supported(jsonb); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.assessment_dimensions_supported(values_json jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
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


--
-- Name: assessment_response_modes_supported(jsonb); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.assessment_response_modes_supported(values_json jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT jsonb_typeof(values_json) = 'array'
     AND jsonb_array_length(values_json) > 0
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(values_json) AS mode(value)
       WHERE jsonb_typeof(value) <> 'string'
          OR value #>> '{}' NOT IN ('free_text', 'choice', 'confusion_probe')
     );
$$;


--
-- Name: has_unresolved_placeholder(jsonb); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.has_unresolved_placeholder(values_json jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT jsonb_typeof(values_json) <> 'array'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(values_json) AS reference(value)
        WHERE skill_trainer.has_unresolved_placeholder(reference.value)
      );
$$;


--
-- Name: has_unresolved_placeholder(text); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.has_unresolved_placeholder(value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $_$
  SELECT value IS NULL
      OR btrim(value) = ''
      OR value ~ '(\.\.\.|…|〜|～|\{|\})'
      OR btrim(value) ~ '^(A|B)$'
      OR (
        value ~ '(^|[^A-Za-z])A([^A-Za-z]|$)'
        AND value ~ '(^|[^A-Za-z])B([^A-Za-z]|$)'
      );
$_$;


--
-- Name: register_confusion_probe_exercise(); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.register_confusion_probe_exercise() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: register_quiz_exercise(); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.register_quiz_exercise() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: register_rendered_exercise(); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.register_rendered_exercise() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: reject_append_only_mutation(); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.reject_append_only_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; append a new version/observation instead', TG_TABLE_NAME;
END;
$$;


--
-- Name: reject_grading_for_non_free_text_attempt(); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.reject_grading_for_non_free_text_attempt() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: reject_versioned_content_mutation(); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.reject_versioned_content_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Operational status may move from active to retired. Versioned content itself
  -- must be replaced by a new identity/version, never edited in place.
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION '% content is immutable; insert a new version instead', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: rubric_dimensions_supported(jsonb); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.rubric_dimensions_supported(rubric jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
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


--
-- Name: validate_capability_evidence_source(); Type: FUNCTION; Schema: skill_trainer; Owner: -
--

CREATE FUNCTION skill_trainer.validate_capability_evidence_source() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: assessment_contracts; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.assessment_contracts (
    contract_key character varying(120) NOT NULL,
    version integer NOT NULL,
    required_dimensions jsonb NOT NULL,
    response_modes jsonb NOT NULL,
    deterministic_policy jsonb NOT NULL,
    ai_observation_schema jsonb,
    evidence_policy character varying(30) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    domain_id bigint NOT NULL,
    CONSTRAINT assessment_contracts_ai_observation_schema_check CHECK (((ai_observation_schema IS NULL) OR (jsonb_typeof(ai_observation_schema) = 'object'::text))),
    CONSTRAINT assessment_contracts_deterministic_policy_check CHECK ((jsonb_typeof(deterministic_policy) = 'object'::text)),
    CONSTRAINT assessment_contracts_evidence_policy_check CHECK (((evidence_policy)::text = ANY ((ARRAY['versioned_reducer'::character varying, 'no_evidence'::character varying])::text[]))),
    CONSTRAINT assessment_contracts_required_dimensions_check CHECK (skill_trainer.assessment_dimensions_supported(required_dimensions)),
    CONSTRAINT assessment_contracts_response_modes_check CHECK (skill_trainer.assessment_response_modes_supported(response_modes)),
    CONSTRAINT assessment_contracts_version_check CHECK ((version > 0))
);


--
-- Name: candidate_skills; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.candidate_skills (
    id bigint NOT NULL,
    pattern character varying(255) NOT NULL,
    meaning text,
    source_context text,
    need_count integer DEFAULT 0 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(20) DEFAULT 'candidate'::character varying NOT NULL,
    review_state character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by text,
    promoted_skill_id bigint,
    promotion_snapshot jsonb,
    CONSTRAINT candidate_skills_need_count_check CHECK ((need_count >= 0)),
    CONSTRAINT candidate_skills_pattern_check CHECK ((length((pattern)::text) > 0)),
    CONSTRAINT candidate_skills_review_state_check CHECK (((review_state)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[]))),
    CONSTRAINT candidate_skills_status_check CHECK (((status)::text = ANY ((ARRAY['candidate'::character varying, 'promoted'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: candidate_skills_id_seq; Type: SEQUENCE; Schema: skill_trainer; Owner: -
--

CREATE SEQUENCE skill_trainer.candidate_skills_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: candidate_skills_id_seq; Type: SEQUENCE OWNED BY; Schema: skill_trainer; Owner: -
--

ALTER SEQUENCE skill_trainer.candidate_skills_id_seq OWNED BY skill_trainer.candidate_skills.id;


--
-- Name: capability_evidence; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.capability_evidence (
    evidence_id uuid NOT NULL,
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    training_attempt_id uuid,
    conversation_turn_id bigint,
    grading_id uuid NOT NULL,
    skill_id bigint NOT NULL,
    capability character varying(40) NOT NULL,
    modality character varying(20) NOT NULL,
    outcome character varying(20) NOT NULL,
    latency_ms integer,
    error_cause character varying(40),
    evidence_confidence smallint NOT NULL,
    derivation_version character varying(80) NOT NULL,
    policy_version character varying(80) NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT capability_evidence_check CHECK (((((training_attempt_id IS NOT NULL))::integer + ((conversation_turn_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT capability_evidence_evidence_confidence_check CHECK (((evidence_confidence >= 0) AND (evidence_confidence <= 100))),
    CONSTRAINT capability_evidence_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0))),
    CONSTRAINT capability_evidence_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['success'::character varying, 'failure'::character varying])::text[])))
);


--
-- Name: confusion_events; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.confusion_events (
    event_id uuid NOT NULL,
    pair_id uuid NOT NULL,
    attempt_id uuid,
    submission_id uuid,
    probe_id uuid,
    kind character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT confusion_events_check CHECK (((attempt_id IS NOT NULL) AND ((((kind)::text = 'mistake'::text) AND (submission_id IS NULL)) OR (((kind)::text = ANY ((ARRAY['probe_success'::character varying, 'probe_failure'::character varying])::text[])) AND (submission_id IS NOT NULL))))),
    CONSTRAINT confusion_events_kind_check CHECK (((kind)::text = ANY ((ARRAY['mistake'::character varying, 'probe_success'::character varying, 'probe_failure'::character varying])::text[])))
);


--
-- Name: confusion_pairs; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.confusion_pairs (
    pair_id uuid NOT NULL,
    label_a text NOT NULL,
    label_b text NOT NULL,
    skill_key_a character varying(100),
    skill_key_b character varying(100),
    key_a text NOT NULL,
    direction_a text NOT NULL,
    key_b text NOT NULL,
    direction_b text NOT NULL,
    source character varying(30) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    confusion_type character varying(20) DEFAULT 'MEANING'::character varying NOT NULL,
    CONSTRAINT confusion_pairs_check CHECK ((label_a < label_b)),
    CONSTRAINT confusion_pairs_label_a_check CHECK ((length(label_a) > 0)),
    CONSTRAINT confusion_pairs_label_b_check CHECK ((length(label_b) > 0)),
    CONSTRAINT confusion_pairs_source_check CHECK (((source)::text = ANY ((ARRAY['catalog'::character varying, 'observed_mistake'::character varying, 'learner_registered'::character varying])::text[]))),
    CONSTRAINT confusion_pairs_type_chk CHECK (((confusion_type)::text = ANY ((ARRAY['DIRECTION'::character varying, 'TIME'::character varying, 'SUBJECT'::character varying, 'INTENT'::character varying, 'MEANING'::character varying, 'REGISTER'::character varying])::text[])))
);


--
-- Name: confusion_probes; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.confusion_probes (
    probe_id uuid NOT NULL,
    pair_id uuid NOT NULL,
    side character(1) NOT NULL,
    ordinal smallint NOT NULL,
    prompt text NOT NULL,
    expected_text text NOT NULL,
    exercise_id uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT confusion_probes_expected_text_check CHECK ((length(expected_text) > 0)),
    CONSTRAINT confusion_probes_ordinal_check CHECK ((ordinal > 0)),
    CONSTRAINT confusion_probes_prompt_check CHECK ((length(prompt) > 0)),
    CONSTRAINT confusion_probes_side_check CHECK ((side = ANY (ARRAY['a'::bpchar, 'b'::bpchar])))
);


--
-- Name: conversation_sessions; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.conversation_sessions (
    id bigint NOT NULL,
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    scenario character varying(20) NOT NULL,
    session_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    turn_count integer DEFAULT 0 NOT NULL,
    self_question_count integer DEFAULT 0 NOT NULL,
    follow_up_count integer DEFAULT 0 NOT NULL,
    error_handling_count integer DEFAULT 0 NOT NULL,
    freeze_count integer DEFAULT 0 NOT NULL,
    japanese_fallback_count integer DEFAULT 0 NOT NULL,
    avg_latency_ms integer,
    candidate_extracted_at timestamp with time zone,
    metrics_version character varying(80),
    candidate_extraction_count integer DEFAULT 0 NOT NULL,
    domain_id bigint NOT NULL,
    CONSTRAINT conversation_sessions_avg_latency_ms_check CHECK (((avg_latency_ms IS NULL) OR (avg_latency_ms >= 0))),
    CONSTRAINT conversation_sessions_candidate_extraction_count_check CHECK ((candidate_extraction_count >= 0)),
    CONSTRAINT conversation_sessions_error_handling_count_check CHECK ((error_handling_count >= 0)),
    CONSTRAINT conversation_sessions_follow_up_count_check CHECK ((follow_up_count >= 0)),
    CONSTRAINT conversation_sessions_freeze_count_check CHECK ((freeze_count >= 0)),
    CONSTRAINT conversation_sessions_japanese_fallback_count_check CHECK ((japanese_fallback_count >= 0)),
    CONSTRAINT conversation_sessions_scenario_check CHECK (((scenario)::text = ANY ((ARRAY['teacher'::character varying, 'learner'::character varying, 'free_talk'::character varying])::text[]))),
    CONSTRAINT conversation_sessions_self_question_count_check CHECK ((self_question_count >= 0)),
    CONSTRAINT conversation_sessions_turn_count_check CHECK ((turn_count >= 0))
);


--
-- Name: conversation_sessions_id_seq; Type: SEQUENCE; Schema: skill_trainer; Owner: -
--

CREATE SEQUENCE skill_trainer.conversation_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: skill_trainer; Owner: -
--

ALTER SEQUENCE skill_trainer.conversation_sessions_id_seq OWNED BY skill_trainer.conversation_sessions.id;


--
-- Name: conversation_turns; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.conversation_turns (
    id bigint NOT NULL,
    conversation_session_id bigint NOT NULL,
    turn_index integer NOT NULL,
    role character varying(10) NOT NULL,
    content text NOT NULL,
    latency_ms integer,
    self_question boolean DEFAULT false NOT NULL,
    follow_up boolean DEFAULT false NOT NULL,
    error_handling boolean DEFAULT false NOT NULL,
    is_freeze boolean DEFAULT false NOT NULL,
    japanese_fallback boolean DEFAULT false NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    client_turn_id uuid,
    CONSTRAINT conversation_turns_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0))),
    CONSTRAINT conversation_turns_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'assistant'::character varying])::text[]))),
    CONSTRAINT conversation_turns_turn_index_check CHECK ((turn_index >= 0))
);


--
-- Name: conversation_turns_id_seq; Type: SEQUENCE; Schema: skill_trainer; Owner: -
--

CREATE SEQUENCE skill_trainer.conversation_turns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_turns_id_seq; Type: SEQUENCE OWNED BY; Schema: skill_trainer; Owner: -
--

ALTER SEQUENCE skill_trainer.conversation_turns_id_seq OWNED BY skill_trainer.conversation_turns.id;


--
-- Name: domain_categories; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.domain_categories (
    domain_id bigint NOT NULL,
    category_code character varying(40) NOT NULL,
    CONSTRAINT domain_categories_category_code_check CHECK ((length((category_code)::text) > 0))
);


--
-- Name: domains; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.domains (
    id bigint NOT NULL,
    code character varying(80) NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT domains_code_check CHECK ((length((code)::text) > 0)),
    CONSTRAINT domains_display_name_check CHECK ((length(display_name) > 0))
);


--
-- Name: domains_id_seq; Type: SEQUENCE; Schema: skill_trainer; Owner: -
--

CREATE SEQUENCE skill_trainer.domains_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: domains_id_seq; Type: SEQUENCE OWNED BY; Schema: skill_trainer; Owner: -
--

ALTER SEQUENCE skill_trainer.domains_id_seq OWNED BY skill_trainer.domains.id;


--
-- Name: grading_observations; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.grading_observations (
    grading_id uuid NOT NULL,
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    training_attempt_id uuid,
    conversation_turn_id bigint,
    source character varying(30) NOT NULL,
    observer_version character varying(100) NOT NULL,
    idempotency_key character(64) NOT NULL,
    status character varying(20) NOT NULL,
    adopted_for_evidence boolean DEFAULT false NOT NULL,
    rubric_version character varying(100) NOT NULL,
    dimension_results jsonb NOT NULL,
    reason text,
    skill_candidates jsonb DEFAULT '[]'::jsonb NOT NULL,
    error_candidates jsonb DEFAULT '[]'::jsonb NOT NULL,
    model_reported_confidence double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grading_observations_check CHECK (((((training_attempt_id IS NOT NULL))::integer + ((conversation_turn_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT grading_observations_check1 CHECK (((NOT adopted_for_evidence) OR ((status)::text = 'graded'::text))),
    CONSTRAINT grading_observations_dimension_results_check CHECK ((jsonb_typeof(dimension_results) = 'object'::text)),
    CONSTRAINT grading_observations_error_candidates_check CHECK ((jsonb_typeof(error_candidates) = 'array'::text)),
    CONSTRAINT grading_observations_model_reported_confidence_check CHECK (((model_reported_confidence IS NULL) OR ((model_reported_confidence >= (0)::double precision) AND (model_reported_confidence <= (1)::double precision)))),
    CONSTRAINT grading_observations_skill_candidates_check CHECK ((jsonb_typeof(skill_candidates) = 'array'::text)),
    CONSTRAINT grading_observations_source_check CHECK (((source)::text = ANY ((ARRAY['deterministic'::character varying, 'ai'::character varying, 'human'::character varying])::text[]))),
    CONSTRAINT grading_observations_status_check CHECK (((status)::text = ANY ((ARRAY['graded'::character varying, 'ungraded'::character varying, 'invalid'::character varying])::text[])))
);


--
-- Name: effective_capability_evidence; Type: VIEW; Schema: skill_trainer; Owner: -
--

CREATE VIEW skill_trainer.effective_capability_evidence AS
 WITH ranked AS (
         SELECT ce.evidence_id,
            ce.training_attempt_id,
            ce.conversation_turn_id,
            ce.grading_id,
            ce.skill_id,
            ce.capability,
            ce.modality,
            ce.outcome,
            ce.latency_ms,
            ce.error_cause,
            ce.evidence_confidence,
            ce.derivation_version,
            ce.policy_version,
            ce.observed_at,
            ce.created_at,
            go.source AS observer_source,
            go.observer_version,
            row_number() OVER (PARTITION BY COALESCE(('attempt:'::text || (ce.training_attempt_id)::text), ('turn:'::text || (ce.conversation_turn_id)::text)), ce.skill_id, ce.capability ORDER BY
                CASE go.source
                    WHEN 'human'::text THEN 3
                    WHEN 'deterministic'::text THEN 2
                    ELSE 1
                END DESC, go.created_at DESC, ce.created_at DESC, ce.evidence_id DESC) AS selection_rank
           FROM (skill_trainer.capability_evidence ce
             JOIN skill_trainer.grading_observations go ON ((go.grading_id = ce.grading_id)))
          WHERE (((go.status)::text = 'graded'::text) AND (go.adopted_for_evidence = true))
        )
 SELECT evidence_id,
    training_attempt_id,
    conversation_turn_id,
    grading_id,
    skill_id,
    capability,
    modality,
    outcome,
    latency_ms,
    error_cause,
    evidence_confidence,
    derivation_version,
    policy_version,
    observed_at,
    created_at,
    observer_source,
    observer_version
   FROM ranked
  WHERE (selection_rank = 1);


--
-- Name: exercise_definitions; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.exercise_definitions (
    exercise_key character varying(100) NOT NULL,
    version integer NOT NULL,
    training_mode character varying(30) NOT NULL,
    target_skill_id bigint NOT NULL,
    target_capability character varying(40) NOT NULL,
    prompt_spec jsonb NOT NULL,
    reference_examples jsonb NOT NULL,
    accepted_variants jsonb DEFAULT '[]'::jsonb NOT NULL,
    rubric jsonb NOT NULL,
    difficulty smallint DEFAULT 1 NOT NULL,
    modality character varying(20) DEFAULT 'text'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    content_hash character(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    assessment_contract_key character varying(120) NOT NULL,
    assessment_contract_version integer NOT NULL,
    CONSTRAINT exercise_definitions_accepted_variants_check CHECK ((jsonb_typeof(accepted_variants) = 'array'::text)),
    CONSTRAINT exercise_definitions_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 5))),
    CONSTRAINT exercise_definitions_modality_check CHECK (((modality)::text = ANY ((ARRAY['text'::character varying, 'audio'::character varying, 'conversation'::character varying])::text[]))),
    CONSTRAINT exercise_definitions_prompt_resolved CHECK ((NOT skill_trainer.has_unresolved_placeholder((prompt_spec ->> 'prompt'::text)))),
    CONSTRAINT exercise_definitions_prompt_spec_check CHECK ((jsonb_typeof(prompt_spec) = 'object'::text)),
    CONSTRAINT exercise_definitions_prompt_spec_check1 CHECK ((prompt_spec ? 'prompt'::text)),
    CONSTRAINT exercise_definitions_prompt_spec_check2 CHECK (((prompt_spec ->> 'prompt'::text) !~~ '%...%'::text)),
    CONSTRAINT exercise_definitions_prompt_spec_check3 CHECK ((((prompt_spec ->> 'prompt'::text) !~~ '%{%'::text) AND ((prompt_spec ->> 'prompt'::text) !~~ '%}%'::text))),
    CONSTRAINT exercise_definitions_reference_examples_check CHECK ((jsonb_typeof(reference_examples) = 'array'::text)),
    CONSTRAINT exercise_definitions_reference_examples_check1 CHECK ((jsonb_array_length(reference_examples) > 0)),
    CONSTRAINT exercise_definitions_references_resolved CHECK ((NOT skill_trainer.has_unresolved_placeholder(reference_examples))),
    CONSTRAINT exercise_definitions_rubric_check CHECK ((jsonb_typeof(rubric) = 'object'::text)),
    CONSTRAINT exercise_definitions_rubric_dimensions_supported CHECK (skill_trainer.rubric_dimensions_supported(rubric)),
    CONSTRAINT exercise_definitions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'retired'::character varying])::text[]))),
    CONSTRAINT exercise_definitions_training_mode_check CHECK (((training_mode)::text = ANY ((ARRAY['recognition'::character varying, 'controlled_recall'::character varying, 'slot_replacement'::character varying, 'contrast_drill'::character varying, 'free_production'::character varying, 'conversation_drill'::character varying, 'spaced_retrieval'::character varying])::text[]))),
    CONSTRAINT exercise_definitions_version_check CHECK ((version > 0))
);


--
-- Name: exercises; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.exercises (
    exercise_id uuid NOT NULL,
    exercise_kind character varying(30) NOT NULL,
    definition_key character varying(120) NOT NULL,
    definition_version integer NOT NULL,
    assessment_contract_key character varying(120) NOT NULL,
    assessment_contract_version integer NOT NULL,
    prompt_snapshot text NOT NULL,
    target_skill_id bigint,
    target_capability character varying(40),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exercises_definition_version_check CHECK ((definition_version > 0)),
    CONSTRAINT exercises_exercise_kind_check CHECK (((exercise_kind)::text = ANY ((ARRAY['rendered_free_text'::character varying, 'quiz_choice'::character varying, 'confusion_probe'::character varying])::text[]))),
    CONSTRAINT exercises_prompt_snapshot_check CHECK ((length(prompt_snapshot) > 0))
);


--
-- Name: learner_phase_gate_policies; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.learner_phase_gate_policies (
    phase smallint NOT NULL,
    version character varying(80) NOT NULL,
    requirements jsonb NOT NULL,
    required_scenarios jsonb DEFAULT '[]'::jsonb NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learner_phase_gate_policies_phase_check CHECK ((phase = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT learner_phase_gate_policies_required_scenarios_check CHECK ((jsonb_typeof(required_scenarios) = 'array'::text)),
    CONSTRAINT learner_phase_gate_policies_requirements_check CHECK ((jsonb_typeof(requirements) = 'array'::text))
);


--
-- Name: learner_settings; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.learner_settings (
    learner_key character varying NOT NULL,
    ai_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: learning_policy_versions; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.learning_policy_versions (
    policy_version character varying(80) NOT NULL,
    status character varying(20) NOT NULL,
    config jsonb NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learning_policy_versions_config_check CHECK ((jsonb_typeof(config) = 'object'::text)),
    CONSTRAINT learning_policy_versions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'retired'::character varying])::text[])))
);


--
-- Name: quiz_attempts; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.quiz_attempts (
    attempt_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    item_key character varying(100) NOT NULL,
    option_set_version integer NOT NULL,
    pair_id uuid,
    capability character varying(40) NOT NULL,
    response_mode character varying(20) NOT NULL,
    modality character varying(30) NOT NULL,
    option_order jsonb NOT NULL,
    selected_option_id character varying(16) NOT NULL,
    correct_option_id character varying(16) NOT NULL,
    selected_kind character varying(10) NOT NULL,
    outcome character varying(20) NOT NULL,
    latency_ms integer,
    answered_at timestamp with time zone DEFAULT now() NOT NULL,
    quiz_type character varying(20) DEFAULT 'contrast'::character varying NOT NULL,
    skill_id bigint,
    training_attempt_id uuid NOT NULL,
    CONSTRAINT quiz_attempts_capability_check CHECK (((capability)::text = ANY ((ARRAY['CONTRAST_SELECTION'::character varying, 'RECOGNITION'::character varying])::text[]))),
    CONSTRAINT quiz_attempts_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0))),
    CONSTRAINT quiz_attempts_modality_check CHECK (((modality)::text = 'multiple_choice'::text)),
    CONSTRAINT quiz_attempts_option_order_check CHECK ((jsonb_typeof(option_order) = 'array'::text)),
    CONSTRAINT quiz_attempts_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['success'::character varying, 'failure'::character varying])::text[]))),
    CONSTRAINT quiz_attempts_response_mode_check CHECK (((response_mode)::text = 'choice'::text)),
    CONSTRAINT quiz_attempts_selected_kind_check CHECK (((selected_kind)::text = ANY ((ARRAY['correct'::character varying, 'pair'::character varying, 'near'::character varying])::text[])))
);


--
-- Name: quiz_items; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.quiz_items (
    item_key character varying(100) NOT NULL,
    option_set_version integer NOT NULL,
    probe_id uuid,
    pair_id uuid,
    capability character varying(40) DEFAULT 'CONTRAST_SELECTION'::character varying NOT NULL,
    prompt text NOT NULL,
    options jsonb NOT NULL,
    correct_option_id character varying(16) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    quiz_type character varying(20) DEFAULT 'contrast'::character varying NOT NULL,
    skill_id bigint,
    exercise_id uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT quiz_items_capability_check CHECK (((capability)::text = ANY ((ARRAY['CONTRAST_SELECTION'::character varying, 'RECOGNITION'::character varying])::text[]))),
    CONSTRAINT quiz_items_option_set_version_check CHECK ((option_set_version > 0)),
    CONSTRAINT quiz_items_options_check CHECK (((jsonb_typeof(options) = 'array'::text) AND (jsonb_array_length(options) = 4))),
    CONSTRAINT quiz_items_prompt_check CHECK ((length(prompt) > 0)),
    CONSTRAINT quiz_items_quiz_type_check CHECK (((quiz_type)::text = ANY ((ARRAY['contrast'::character varying, 'meaning'::character varying, 'intent'::character varying, 'form'::character varying])::text[]))),
    CONSTRAINT quiz_items_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'retired'::character varying])::text[]))),
    CONSTRAINT quiz_items_target_check CHECK (((pair_id IS NOT NULL) OR (skill_id IS NOT NULL)))
);


--
-- Name: quiz_promotions; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.quiz_promotions (
    promotion_id uuid NOT NULL,
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    pair_id uuid,
    promoted_at timestamp with time zone DEFAULT now() NOT NULL,
    skill_id bigint,
    CONSTRAINT quiz_promotions_target_check CHECK (((pair_id IS NOT NULL) OR (skill_id IS NOT NULL)))
);


--
-- Name: rendered_exercises; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.rendered_exercises (
    exercise_instance_id uuid NOT NULL,
    materialization_key character(64) NOT NULL,
    plan_item_id uuid,
    exercise_key character varying(100) NOT NULL,
    exercise_version integer NOT NULL,
    prompt text NOT NULL,
    expected_reference text NOT NULL,
    accepted_variants jsonb NOT NULL,
    rubric_snapshot jsonb NOT NULL,
    resolved_slots jsonb DEFAULT '{}'::jsonb NOT NULL,
    modality character varying(20) NOT NULL,
    generator_version character varying(80) NOT NULL,
    policy_version character varying(80) NOT NULL,
    content_hash character(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rendered_exercises_accepted_variants_check CHECK ((jsonb_typeof(accepted_variants) = 'array'::text)),
    CONSTRAINT rendered_exercises_check CHECK (((prompt !~~ '%...%'::text) AND (expected_reference !~~ '%...%'::text))),
    CONSTRAINT rendered_exercises_content_resolved CHECK (((NOT skill_trainer.has_unresolved_placeholder(prompt)) AND (NOT skill_trainer.has_unresolved_placeholder(expected_reference)))),
    CONSTRAINT rendered_exercises_expected_reference_check CHECK ((length(expected_reference) > 0)),
    CONSTRAINT rendered_exercises_expected_reference_check1 CHECK (((expected_reference !~~ '%{%'::text) AND (expected_reference !~~ '%}%'::text))),
    CONSTRAINT rendered_exercises_prompt_check CHECK ((length(prompt) > 0)),
    CONSTRAINT rendered_exercises_prompt_check1 CHECK (((prompt !~~ '%{%'::text) AND (prompt !~~ '%}%'::text))),
    CONSTRAINT rendered_exercises_resolved_slots_check CHECK ((jsonb_typeof(resolved_slots) = 'object'::text)),
    CONSTRAINT rendered_exercises_rubric_dimensions_supported CHECK (skill_trainer.rubric_dimensions_supported(rubric_snapshot)),
    CONSTRAINT rendered_exercises_rubric_snapshot_check CHECK ((jsonb_typeof(rubric_snapshot) = 'object'::text))
);


--
-- Name: review_resets; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.review_resets (
    reset_id uuid NOT NULL,
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    domain_id bigint NOT NULL
);


--
-- Name: skill_concepts; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.skill_concepts (
    id bigint NOT NULL,
    stable_key character varying(100) NOT NULL,
    canonical_form character varying(255) NOT NULL,
    meaning text NOT NULL,
    category character varying(20) NOT NULL,
    intent character varying(50),
    phase smallint DEFAULT 1 NOT NULL,
    tier character varying(20) DEFAULT 'CORE'::character varying NOT NULL,
    direction character varying(10) DEFAULT 'OUTPUT'::character varying NOT NULL,
    concept_kind character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    review_source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    domain_id bigint NOT NULL,
    CONSTRAINT skill_concepts_canonical_form_check CHECK ((length((canonical_form)::text) > 0)),
    CONSTRAINT skill_concepts_concept_kind_check CHECK (((concept_kind)::text = ANY ((ARRAY['pattern'::character varying, 'atomic_chunk'::character varying])::text[]))),
    CONSTRAINT skill_concepts_direction_check CHECK (((direction)::text = ANY ((ARRAY['OUTPUT'::character varying, 'INPUT'::character varying])::text[]))),
    CONSTRAINT skill_concepts_meaning_check CHECK ((length(meaning) > 0)),
    CONSTRAINT skill_concepts_phase_check CHECK ((phase = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT skill_concepts_stable_key_check CHECK ((length((stable_key)::text) > 0)),
    CONSTRAINT skill_concepts_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'retired'::character varying])::text[]))),
    CONSTRAINT skill_concepts_tier_check CHECK (((tier)::text = ANY ((ARRAY['CORE'::character varying, 'TIER1'::character varying])::text[])))
);


--
-- Name: skill_concepts_id_seq; Type: SEQUENCE; Schema: skill_trainer; Owner: -
--

CREATE SEQUENCE skill_trainer.skill_concepts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skill_concepts_id_seq; Type: SEQUENCE OWNED BY; Schema: skill_trainer; Owner: -
--

ALTER SEQUENCE skill_trainer.skill_concepts_id_seq OWNED BY skill_trainer.skill_concepts.id;


--
-- Name: training_attempts; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.training_attempts (
    attempt_id uuid NOT NULL,
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    plan_item_id uuid,
    exercise_instance_id uuid,
    actual text NOT NULL,
    input_modality character varying(20) DEFAULT 'text'::character varying NOT NULL,
    latency_ms integer,
    session_id uuid,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    response_mode character varying(20) DEFAULT 'free_text'::character varying NOT NULL,
    exercise_id uuid NOT NULL,
    CONSTRAINT training_attempts_actual_check CHECK ((length(actual) > 0)),
    CONSTRAINT training_attempts_input_modality_check CHECK (((input_modality)::text = ANY ((ARRAY['text'::character varying, 'audio'::character varying])::text[]))),
    CONSTRAINT training_attempts_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0))),
    CONSTRAINT training_attempts_mode_shape_check CHECK (((((response_mode)::text = 'free_text'::text) AND (exercise_instance_id IS NOT NULL)) OR (((response_mode)::text <> 'free_text'::text) AND (exercise_instance_id IS NULL)))),
    CONSTRAINT training_attempts_response_mode_check CHECK (((response_mode)::text = ANY ((ARRAY['free_text'::character varying, 'choice'::character varying, 'confusion_probe'::character varying])::text[])))
);


--
-- Name: training_plan_items; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.training_plan_items (
    plan_item_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    ordinal smallint NOT NULL,
    purpose character varying(10) NOT NULL,
    skill_id bigint NOT NULL,
    target_capability character varying(40) NOT NULL,
    diagnosis_id uuid,
    diagnosis_type character varying(40),
    exercise_key character varying(100) NOT NULL,
    exercise_version integer NOT NULL,
    training_mode character varying(30) NOT NULL,
    reason_code character varying(80) NOT NULL,
    selection_snapshot jsonb NOT NULL,
    dose integer NOT NULL,
    stop_condition jsonb NOT NULL,
    status character varying(20) DEFAULT 'planned'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT training_plan_items_check CHECK (((((purpose)::text = 'Measure'::text) AND (diagnosis_id IS NULL)) OR (((purpose)::text = ANY ((ARRAY['Train'::character varying, 'Verify'::character varying])::text[])) AND (diagnosis_id IS NOT NULL)))),
    CONSTRAINT training_plan_items_dose_check CHECK ((dose > 0)),
    CONSTRAINT training_plan_items_ordinal_check CHECK ((ordinal > 0)),
    CONSTRAINT training_plan_items_purpose_check CHECK (((purpose)::text = ANY ((ARRAY['Measure'::character varying, 'Train'::character varying, 'Verify'::character varying])::text[]))),
    CONSTRAINT training_plan_items_selection_snapshot_check CHECK ((jsonb_typeof(selection_snapshot) = 'object'::text)),
    CONSTRAINT training_plan_items_status_check CHECK (((status)::text = ANY ((ARRAY['planned'::character varying, 'in_progress'::character varying, 'awaiting_grade'::character varying, 'completed'::character varying, 'skipped'::character varying])::text[]))),
    CONSTRAINT training_plan_items_stop_condition_check CHECK ((jsonb_typeof(stop_condition) = 'object'::text))
);


--
-- Name: training_plans; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.training_plans (
    plan_id uuid NOT NULL,
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    planner_key character(64) NOT NULL,
    policy_version character varying(80) NOT NULL,
    input_snapshot jsonb NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    domain_id bigint NOT NULL,
    CONSTRAINT training_plans_input_snapshot_check CHECK ((jsonb_typeof(input_snapshot) = 'object'::text)),
    CONSTRAINT training_plans_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'completed'::character varying, 'superseded'::character varying])::text[])))
);


--
-- Name: weakness_diagnoses; Type: TABLE; Schema: skill_trainer; Owner: -
--

CREATE TABLE skill_trainer.weakness_diagnoses (
    diagnosis_id uuid NOT NULL,
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    skill_id bigint NOT NULL,
    target_capability character varying(40) NOT NULL,
    type character varying(40) NOT NULL,
    status character varying(20) NOT NULL,
    severity smallint NOT NULL,
    confidence smallint NOT NULL,
    evidence_refs uuid[] NOT NULL,
    evidence_snapshot jsonb NOT NULL,
    evidence_window interval NOT NULL,
    evidence_count integer NOT NULL,
    diagnosed_at timestamp with time zone DEFAULT now() NOT NULL,
    last_confirmed_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    estimator_version character varying(80) NOT NULL,
    diagnosis_rule_version character varying(80) NOT NULL,
    policy_version character varying(80) NOT NULL,
    CONSTRAINT weakness_diagnoses_check CHECK (((((status)::text = 'active'::text) AND (resolved_at IS NULL)) OR (((status)::text = 'resolved'::text) AND (resolved_at IS NOT NULL)))),
    CONSTRAINT weakness_diagnoses_confidence_check CHECK (((confidence >= 0) AND (confidence <= 100))),
    CONSTRAINT weakness_diagnoses_evidence_count_check CHECK ((evidence_count >= 0)),
    CONSTRAINT weakness_diagnoses_evidence_snapshot_check CHECK ((jsonb_typeof(evidence_snapshot) = 'object'::text)),
    CONSTRAINT weakness_diagnoses_severity_check CHECK (((severity >= 0) AND (severity <= 100))),
    CONSTRAINT weakness_diagnoses_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'resolved'::character varying])::text[])))
);


--
-- Name: candidate_skills id; Type: DEFAULT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.candidate_skills ALTER COLUMN id SET DEFAULT nextval('skill_trainer.candidate_skills_id_seq'::regclass);


--
-- Name: conversation_sessions id; Type: DEFAULT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.conversation_sessions ALTER COLUMN id SET DEFAULT nextval('skill_trainer.conversation_sessions_id_seq'::regclass);


--
-- Name: conversation_turns id; Type: DEFAULT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.conversation_turns ALTER COLUMN id SET DEFAULT nextval('skill_trainer.conversation_turns_id_seq'::regclass);


--
-- Name: domains id; Type: DEFAULT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.domains ALTER COLUMN id SET DEFAULT nextval('skill_trainer.domains_id_seq'::regclass);


--
-- Name: skill_concepts id; Type: DEFAULT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.skill_concepts ALTER COLUMN id SET DEFAULT nextval('skill_trainer.skill_concepts_id_seq'::regclass);


--
-- Name: assessment_contracts assessment_contracts_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.assessment_contracts
    ADD CONSTRAINT assessment_contracts_pkey PRIMARY KEY (contract_key, version);


--
-- Name: candidate_skills candidate_skills_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.candidate_skills
    ADD CONSTRAINT candidate_skills_pkey PRIMARY KEY (id);


--
-- Name: capability_evidence capability_evidence_grading_id_skill_id_capability_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.capability_evidence
    ADD CONSTRAINT capability_evidence_grading_id_skill_id_capability_key UNIQUE (grading_id, skill_id, capability);


--
-- Name: capability_evidence capability_evidence_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.capability_evidence
    ADD CONSTRAINT capability_evidence_pkey PRIMARY KEY (evidence_id);


--
-- Name: confusion_events confusion_events_attempt_id_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.confusion_events
    ADD CONSTRAINT confusion_events_attempt_id_key UNIQUE (attempt_id);


--
-- Name: confusion_events confusion_events_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.confusion_events
    ADD CONSTRAINT confusion_events_pkey PRIMARY KEY (event_id);


--
-- Name: confusion_events confusion_events_submission_id_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.confusion_events
    ADD CONSTRAINT confusion_events_submission_id_key UNIQUE (submission_id);


--
-- Name: confusion_pairs confusion_pairs_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.confusion_pairs
    ADD CONSTRAINT confusion_pairs_pkey PRIMARY KEY (pair_id);


--
-- Name: confusion_probes confusion_probes_exercise_id_unique; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.confusion_probes
    ADD CONSTRAINT confusion_probes_exercise_id_unique UNIQUE (exercise_id);


--
-- Name: confusion_probes confusion_probes_pair_id_side_ordinal_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.confusion_probes
    ADD CONSTRAINT confusion_probes_pair_id_side_ordinal_key UNIQUE (pair_id, side, ordinal);


--
-- Name: confusion_probes confusion_probes_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.confusion_probes
    ADD CONSTRAINT confusion_probes_pkey PRIMARY KEY (probe_id);


--
-- Name: conversation_sessions conversation_sessions_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.conversation_sessions
    ADD CONSTRAINT conversation_sessions_pkey PRIMARY KEY (id);


--
-- Name: conversation_turns conversation_turns_conversation_session_id_turn_index_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.conversation_turns
    ADD CONSTRAINT conversation_turns_conversation_session_id_turn_index_key UNIQUE (conversation_session_id, turn_index);


--
-- Name: conversation_turns conversation_turns_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.conversation_turns
    ADD CONSTRAINT conversation_turns_pkey PRIMARY KEY (id);


--
-- Name: domain_categories domain_categories_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.domain_categories
    ADD CONSTRAINT domain_categories_pkey PRIMARY KEY (domain_id, category_code);


--
-- Name: domains domains_code_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.domains
    ADD CONSTRAINT domains_code_key UNIQUE (code);


--
-- Name: domains domains_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.domains
    ADD CONSTRAINT domains_pkey PRIMARY KEY (id);


--
-- Name: exercise_definitions exercise_definitions_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.exercise_definitions
    ADD CONSTRAINT exercise_definitions_pkey PRIMARY KEY (exercise_key, version);


--
-- Name: exercises exercises_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.exercises
    ADD CONSTRAINT exercises_pkey PRIMARY KEY (exercise_id);


--
-- Name: grading_observations grading_observations_idempotency_key_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.grading_observations
    ADD CONSTRAINT grading_observations_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: grading_observations grading_observations_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.grading_observations
    ADD CONSTRAINT grading_observations_pkey PRIMARY KEY (grading_id);


--
-- Name: learner_phase_gate_policies learner_phase_gate_policies_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.learner_phase_gate_policies
    ADD CONSTRAINT learner_phase_gate_policies_pkey PRIMARY KEY (phase, version);


--
-- Name: learner_settings learner_settings_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.learner_settings
    ADD CONSTRAINT learner_settings_pkey PRIMARY KEY (learner_key);


--
-- Name: learning_policy_versions learning_policy_versions_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.learning_policy_versions
    ADD CONSTRAINT learning_policy_versions_pkey PRIMARY KEY (policy_version);


--
-- Name: quiz_attempts quiz_attempts_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_attempts
    ADD CONSTRAINT quiz_attempts_pkey PRIMARY KEY (attempt_id);


--
-- Name: quiz_attempts quiz_attempts_submission_id_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_attempts
    ADD CONSTRAINT quiz_attempts_submission_id_key UNIQUE (submission_id);


--
-- Name: quiz_items quiz_items_exercise_id_unique; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_items
    ADD CONSTRAINT quiz_items_exercise_id_unique UNIQUE (exercise_id);


--
-- Name: quiz_items quiz_items_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_items
    ADD CONSTRAINT quiz_items_pkey PRIMARY KEY (item_key, option_set_version);


--
-- Name: quiz_promotions quiz_promotions_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_promotions
    ADD CONSTRAINT quiz_promotions_pkey PRIMARY KEY (promotion_id);


--
-- Name: rendered_exercises rendered_exercises_materialization_key_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.rendered_exercises
    ADD CONSTRAINT rendered_exercises_materialization_key_key UNIQUE (materialization_key);


--
-- Name: rendered_exercises rendered_exercises_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.rendered_exercises
    ADD CONSTRAINT rendered_exercises_pkey PRIMARY KEY (exercise_instance_id);


--
-- Name: review_resets review_resets_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.review_resets
    ADD CONSTRAINT review_resets_pkey PRIMARY KEY (reset_id);


--
-- Name: skill_concepts skill_concepts_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.skill_concepts
    ADD CONSTRAINT skill_concepts_pkey PRIMARY KEY (id);


--
-- Name: skill_concepts skill_concepts_stable_key_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.skill_concepts
    ADD CONSTRAINT skill_concepts_stable_key_key UNIQUE (stable_key);


--
-- Name: training_attempts training_attempts_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_attempts
    ADD CONSTRAINT training_attempts_pkey PRIMARY KEY (attempt_id);


--
-- Name: training_plan_items training_plan_items_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_plan_items
    ADD CONSTRAINT training_plan_items_pkey PRIMARY KEY (plan_item_id);


--
-- Name: training_plan_items training_plan_items_plan_id_ordinal_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_plan_items
    ADD CONSTRAINT training_plan_items_plan_id_ordinal_key UNIQUE (plan_id, ordinal);


--
-- Name: training_plans training_plans_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_plans
    ADD CONSTRAINT training_plans_pkey PRIMARY KEY (plan_id);


--
-- Name: training_plans training_plans_planner_key_key; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_plans
    ADD CONSTRAINT training_plans_planner_key_key UNIQUE (planner_key);


--
-- Name: weakness_diagnoses weakness_diagnoses_pkey; Type: CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.weakness_diagnoses
    ADD CONSTRAINT weakness_diagnoses_pkey PRIMARY KEY (diagnosis_id);


--
-- Name: candidate_skills_status_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX candidate_skills_status_idx ON skill_trainer.candidate_skills USING btree (status);


--
-- Name: capability_evidence_estimate_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX capability_evidence_estimate_idx ON skill_trainer.capability_evidence USING btree (skill_id, capability, modality, observed_at DESC);


--
-- Name: capability_evidence_one_turn_capability_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE UNIQUE INDEX capability_evidence_one_turn_capability_idx ON skill_trainer.capability_evidence USING btree (conversation_turn_id, skill_id, capability) WHERE (conversation_turn_id IS NOT NULL);


--
-- Name: conversation_sessions_domain_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX conversation_sessions_domain_idx ON skill_trainer.conversation_sessions USING btree (domain_id, started_at);


--
-- Name: conversation_sessions_session_id_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE UNIQUE INDEX conversation_sessions_session_id_idx ON skill_trainer.conversation_sessions USING btree (session_id);


--
-- Name: conversation_sessions_started_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX conversation_sessions_started_idx ON skill_trainer.conversation_sessions USING btree (started_at);


--
-- Name: conversation_turns_client_turn_id_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE UNIQUE INDEX conversation_turns_client_turn_id_idx ON skill_trainer.conversation_turns USING btree (client_turn_id) WHERE (client_turn_id IS NOT NULL);


--
-- Name: conversation_turns_session_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX conversation_turns_session_idx ON skill_trainer.conversation_turns USING btree (conversation_session_id);


--
-- Name: exercise_definitions_target_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX exercise_definitions_target_idx ON skill_trainer.exercise_definitions USING btree (target_skill_id, target_capability, training_mode, status);


--
-- Name: grading_observations_attempt_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX grading_observations_attempt_idx ON skill_trainer.grading_observations USING btree (training_attempt_id, created_at);


--
-- Name: grading_observations_one_adopted_turn_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE UNIQUE INDEX grading_observations_one_adopted_turn_idx ON skill_trainer.grading_observations USING btree (conversation_turn_id) WHERE ((conversation_turn_id IS NOT NULL) AND (adopted_for_evidence = true));


--
-- Name: learning_policy_versions_one_active_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE UNIQUE INDEX learning_policy_versions_one_active_idx ON skill_trainer.learning_policy_versions USING btree (status) WHERE ((status)::text = 'active'::text);


--
-- Name: quiz_attempts_learner_answered_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX quiz_attempts_learner_answered_idx ON skill_trainer.quiz_attempts USING btree (learner_key, answered_at DESC);


--
-- Name: quiz_attempts_pair_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX quiz_attempts_pair_idx ON skill_trainer.quiz_attempts USING btree (pair_id, answered_at DESC);


--
-- Name: quiz_attempts_skill_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX quiz_attempts_skill_idx ON skill_trainer.quiz_attempts USING btree (skill_id, answered_at DESC);


--
-- Name: quiz_attempts_training_attempt_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX quiz_attempts_training_attempt_idx ON skill_trainer.quiz_attempts USING btree (training_attempt_id);


--
-- Name: quiz_promotions_pair_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX quiz_promotions_pair_idx ON skill_trainer.quiz_promotions USING btree (learner_key, pair_id, promoted_at DESC);


--
-- Name: review_resets_domain_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX review_resets_domain_idx ON skill_trainer.review_resets USING btree (domain_id, learner_key, requested_at);


--
-- Name: review_resets_learner_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX review_resets_learner_idx ON skill_trainer.review_resets USING btree (learner_key, requested_at DESC);


--
-- Name: skill_concepts_domain_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX skill_concepts_domain_idx ON skill_trainer.skill_concepts USING btree (domain_id, status);


--
-- Name: training_plans_domain_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE INDEX training_plans_domain_idx ON skill_trainer.training_plans USING btree (domain_id, learner_key, status);


--
-- Name: training_plans_one_active_learner_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE UNIQUE INDEX training_plans_one_active_learner_idx ON skill_trainer.training_plans USING btree (learner_key) WHERE ((status)::text = 'active'::text);


--
-- Name: weakness_diagnoses_one_active_idx; Type: INDEX; Schema: skill_trainer; Owner: -
--

CREATE UNIQUE INDEX weakness_diagnoses_one_active_idx ON skill_trainer.weakness_diagnoses USING btree (learner_key, skill_id, target_capability, type) WHERE ((status)::text = 'active'::text);


--
-- Name: assessment_contracts assessment_contracts_append_only; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER assessment_contracts_append_only BEFORE DELETE OR UPDATE ON skill_trainer.assessment_contracts FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();


--
-- Name: capability_evidence capability_evidence_append_only; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER capability_evidence_append_only BEFORE DELETE OR UPDATE ON skill_trainer.capability_evidence FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();


--
-- Name: capability_evidence capability_evidence_validate_source; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER capability_evidence_validate_source BEFORE INSERT ON skill_trainer.capability_evidence FOR EACH ROW EXECUTE FUNCTION skill_trainer.validate_capability_evidence_source();


--
-- Name: confusion_probes confusion_probes_register_core_exercise; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER confusion_probes_register_core_exercise AFTER INSERT ON skill_trainer.confusion_probes FOR EACH ROW EXECUTE FUNCTION skill_trainer.register_confusion_probe_exercise();


--
-- Name: exercise_definitions exercise_definitions_content_immutable; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER exercise_definitions_content_immutable BEFORE UPDATE ON skill_trainer.exercise_definitions FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_versioned_content_mutation();


--
-- Name: exercise_definitions exercise_definitions_no_delete; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER exercise_definitions_no_delete BEFORE DELETE ON skill_trainer.exercise_definitions FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();


--
-- Name: exercises exercises_append_only; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER exercises_append_only BEFORE DELETE OR UPDATE ON skill_trainer.exercises FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();


--
-- Name: grading_observations grading_observations_append_only; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER grading_observations_append_only BEFORE DELETE OR UPDATE ON skill_trainer.grading_observations FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();


--
-- Name: grading_observations grading_observations_require_free_text_attempt; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER grading_observations_require_free_text_attempt BEFORE INSERT ON skill_trainer.grading_observations FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_grading_for_non_free_text_attempt();


--
-- Name: learner_phase_gate_policies learner_phase_gate_policies_append_only; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER learner_phase_gate_policies_append_only BEFORE DELETE OR UPDATE ON skill_trainer.learner_phase_gate_policies FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();


--
-- Name: learning_policy_versions learning_policy_versions_content_immutable; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER learning_policy_versions_content_immutable BEFORE UPDATE ON skill_trainer.learning_policy_versions FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_versioned_content_mutation();


--
-- Name: learning_policy_versions learning_policy_versions_no_delete; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER learning_policy_versions_no_delete BEFORE DELETE ON skill_trainer.learning_policy_versions FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();


--
-- Name: quiz_attempts quiz_attempts_append_only; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER quiz_attempts_append_only BEFORE DELETE OR UPDATE ON skill_trainer.quiz_attempts FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();


--
-- Name: quiz_items quiz_items_register_core_exercise; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER quiz_items_register_core_exercise AFTER INSERT ON skill_trainer.quiz_items FOR EACH ROW EXECUTE FUNCTION skill_trainer.register_quiz_exercise();


--
-- Name: rendered_exercises rendered_exercises_append_only; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER rendered_exercises_append_only BEFORE DELETE OR UPDATE ON skill_trainer.rendered_exercises FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();


--
-- Name: rendered_exercises rendered_exercises_register_core_exercise; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER rendered_exercises_register_core_exercise AFTER INSERT ON skill_trainer.rendered_exercises FOR EACH ROW EXECUTE FUNCTION skill_trainer.register_rendered_exercise();


--
-- Name: training_attempts training_attempts_append_only; Type: TRIGGER; Schema: skill_trainer; Owner: -
--

CREATE TRIGGER training_attempts_append_only BEFORE DELETE OR UPDATE ON skill_trainer.training_attempts FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();


--
-- Name: assessment_contracts assessment_contracts_domain_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.assessment_contracts
    ADD CONSTRAINT assessment_contracts_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES skill_trainer.domains(id);


--
-- Name: candidate_skills candidate_skills_promoted_skill_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.candidate_skills
    ADD CONSTRAINT candidate_skills_promoted_skill_id_fkey FOREIGN KEY (promoted_skill_id) REFERENCES skill_trainer.skill_concepts(id);


--
-- Name: capability_evidence capability_evidence_conversation_turn_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.capability_evidence
    ADD CONSTRAINT capability_evidence_conversation_turn_id_fkey FOREIGN KEY (conversation_turn_id) REFERENCES skill_trainer.conversation_turns(id);


--
-- Name: capability_evidence capability_evidence_grading_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.capability_evidence
    ADD CONSTRAINT capability_evidence_grading_id_fkey FOREIGN KEY (grading_id) REFERENCES skill_trainer.grading_observations(grading_id);


--
-- Name: capability_evidence capability_evidence_policy_version_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.capability_evidence
    ADD CONSTRAINT capability_evidence_policy_version_fkey FOREIGN KEY (policy_version) REFERENCES skill_trainer.learning_policy_versions(policy_version);


--
-- Name: capability_evidence capability_evidence_skill_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.capability_evidence
    ADD CONSTRAINT capability_evidence_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES skill_trainer.skill_concepts(id);


--
-- Name: capability_evidence capability_evidence_training_attempt_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.capability_evidence
    ADD CONSTRAINT capability_evidence_training_attempt_id_fkey FOREIGN KEY (training_attempt_id) REFERENCES skill_trainer.training_attempts(attempt_id);


--
-- Name: confusion_events confusion_events_attempt_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.confusion_events
    ADD CONSTRAINT confusion_events_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES skill_trainer.training_attempts(attempt_id);


--
-- Name: confusion_events confusion_events_pair_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.confusion_events
    ADD CONSTRAINT confusion_events_pair_id_fkey FOREIGN KEY (pair_id) REFERENCES skill_trainer.confusion_pairs(pair_id);


--
-- Name: confusion_events confusion_events_probe_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.confusion_events
    ADD CONSTRAINT confusion_events_probe_id_fkey FOREIGN KEY (probe_id) REFERENCES skill_trainer.confusion_probes(probe_id);


--
-- Name: confusion_probes confusion_probes_pair_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.confusion_probes
    ADD CONSTRAINT confusion_probes_pair_id_fkey FOREIGN KEY (pair_id) REFERENCES skill_trainer.confusion_pairs(pair_id);


--
-- Name: conversation_sessions conversation_sessions_domain_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.conversation_sessions
    ADD CONSTRAINT conversation_sessions_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES skill_trainer.domains(id);


--
-- Name: conversation_turns conversation_turns_conversation_session_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.conversation_turns
    ADD CONSTRAINT conversation_turns_conversation_session_id_fkey FOREIGN KEY (conversation_session_id) REFERENCES skill_trainer.conversation_sessions(id);


--
-- Name: domain_categories domain_categories_domain_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.domain_categories
    ADD CONSTRAINT domain_categories_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES skill_trainer.domains(id);


--
-- Name: exercise_definitions exercise_definitions_assessment_contract_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.exercise_definitions
    ADD CONSTRAINT exercise_definitions_assessment_contract_fkey FOREIGN KEY (assessment_contract_key, assessment_contract_version) REFERENCES skill_trainer.assessment_contracts(contract_key, version);


--
-- Name: exercise_definitions exercise_definitions_target_skill_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.exercise_definitions
    ADD CONSTRAINT exercise_definitions_target_skill_id_fkey FOREIGN KEY (target_skill_id) REFERENCES skill_trainer.skill_concepts(id);


--
-- Name: exercises exercises_assessment_contract_key_assessment_contract_vers_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.exercises
    ADD CONSTRAINT exercises_assessment_contract_key_assessment_contract_vers_fkey FOREIGN KEY (assessment_contract_key, assessment_contract_version) REFERENCES skill_trainer.assessment_contracts(contract_key, version);


--
-- Name: exercises exercises_target_skill_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.exercises
    ADD CONSTRAINT exercises_target_skill_id_fkey FOREIGN KEY (target_skill_id) REFERENCES skill_trainer.skill_concepts(id);


--
-- Name: grading_observations grading_observations_conversation_turn_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.grading_observations
    ADD CONSTRAINT grading_observations_conversation_turn_id_fkey FOREIGN KEY (conversation_turn_id) REFERENCES skill_trainer.conversation_turns(id);


--
-- Name: grading_observations grading_observations_training_attempt_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.grading_observations
    ADD CONSTRAINT grading_observations_training_attempt_id_fkey FOREIGN KEY (training_attempt_id) REFERENCES skill_trainer.training_attempts(attempt_id);


--
-- Name: quiz_attempts quiz_attempts_item_key_option_set_version_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_attempts
    ADD CONSTRAINT quiz_attempts_item_key_option_set_version_fkey FOREIGN KEY (item_key, option_set_version) REFERENCES skill_trainer.quiz_items(item_key, option_set_version);


--
-- Name: quiz_attempts quiz_attempts_pair_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_attempts
    ADD CONSTRAINT quiz_attempts_pair_id_fkey FOREIGN KEY (pair_id) REFERENCES skill_trainer.confusion_pairs(pair_id);


--
-- Name: quiz_attempts quiz_attempts_skill_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_attempts
    ADD CONSTRAINT quiz_attempts_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES skill_trainer.skill_concepts(id);


--
-- Name: quiz_attempts quiz_attempts_training_attempt_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_attempts
    ADD CONSTRAINT quiz_attempts_training_attempt_id_fkey FOREIGN KEY (training_attempt_id) REFERENCES skill_trainer.training_attempts(attempt_id);


--
-- Name: quiz_items quiz_items_pair_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_items
    ADD CONSTRAINT quiz_items_pair_id_fkey FOREIGN KEY (pair_id) REFERENCES skill_trainer.confusion_pairs(pair_id);


--
-- Name: quiz_items quiz_items_probe_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_items
    ADD CONSTRAINT quiz_items_probe_id_fkey FOREIGN KEY (probe_id) REFERENCES skill_trainer.confusion_probes(probe_id);


--
-- Name: quiz_items quiz_items_skill_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_items
    ADD CONSTRAINT quiz_items_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES skill_trainer.skill_concepts(id);


--
-- Name: quiz_promotions quiz_promotions_pair_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_promotions
    ADD CONSTRAINT quiz_promotions_pair_id_fkey FOREIGN KEY (pair_id) REFERENCES skill_trainer.confusion_pairs(pair_id);


--
-- Name: quiz_promotions quiz_promotions_skill_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.quiz_promotions
    ADD CONSTRAINT quiz_promotions_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES skill_trainer.skill_concepts(id);


--
-- Name: rendered_exercises rendered_exercises_exercise_key_exercise_version_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.rendered_exercises
    ADD CONSTRAINT rendered_exercises_exercise_key_exercise_version_fkey FOREIGN KEY (exercise_key, exercise_version) REFERENCES skill_trainer.exercise_definitions(exercise_key, version);


--
-- Name: rendered_exercises rendered_exercises_plan_item_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.rendered_exercises
    ADD CONSTRAINT rendered_exercises_plan_item_id_fkey FOREIGN KEY (plan_item_id) REFERENCES skill_trainer.training_plan_items(plan_item_id);


--
-- Name: rendered_exercises rendered_exercises_policy_version_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.rendered_exercises
    ADD CONSTRAINT rendered_exercises_policy_version_fkey FOREIGN KEY (policy_version) REFERENCES skill_trainer.learning_policy_versions(policy_version);


--
-- Name: review_resets review_resets_domain_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.review_resets
    ADD CONSTRAINT review_resets_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES skill_trainer.domains(id);


--
-- Name: skill_concepts skill_concepts_domain_category_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.skill_concepts
    ADD CONSTRAINT skill_concepts_domain_category_fkey FOREIGN KEY (domain_id, category) REFERENCES skill_trainer.domain_categories(domain_id, category_code);


--
-- Name: skill_concepts skill_concepts_domain_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.skill_concepts
    ADD CONSTRAINT skill_concepts_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES skill_trainer.domains(id);


--
-- Name: training_attempts training_attempts_exercise_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_attempts
    ADD CONSTRAINT training_attempts_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES skill_trainer.exercises(exercise_id);


--
-- Name: training_attempts training_attempts_exercise_instance_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_attempts
    ADD CONSTRAINT training_attempts_exercise_instance_id_fkey FOREIGN KEY (exercise_instance_id) REFERENCES skill_trainer.rendered_exercises(exercise_instance_id);


--
-- Name: training_attempts training_attempts_plan_item_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_attempts
    ADD CONSTRAINT training_attempts_plan_item_id_fkey FOREIGN KEY (plan_item_id) REFERENCES skill_trainer.training_plan_items(plan_item_id);


--
-- Name: training_plan_items training_plan_items_diagnosis_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_plan_items
    ADD CONSTRAINT training_plan_items_diagnosis_id_fkey FOREIGN KEY (diagnosis_id) REFERENCES skill_trainer.weakness_diagnoses(diagnosis_id);


--
-- Name: training_plan_items training_plan_items_exercise_key_exercise_version_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_plan_items
    ADD CONSTRAINT training_plan_items_exercise_key_exercise_version_fkey FOREIGN KEY (exercise_key, exercise_version) REFERENCES skill_trainer.exercise_definitions(exercise_key, version);


--
-- Name: training_plan_items training_plan_items_plan_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_plan_items
    ADD CONSTRAINT training_plan_items_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES skill_trainer.training_plans(plan_id);


--
-- Name: training_plan_items training_plan_items_skill_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_plan_items
    ADD CONSTRAINT training_plan_items_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES skill_trainer.skill_concepts(id);


--
-- Name: training_plans training_plans_domain_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_plans
    ADD CONSTRAINT training_plans_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES skill_trainer.domains(id);


--
-- Name: training_plans training_plans_policy_version_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.training_plans
    ADD CONSTRAINT training_plans_policy_version_fkey FOREIGN KEY (policy_version) REFERENCES skill_trainer.learning_policy_versions(policy_version);


--
-- Name: weakness_diagnoses weakness_diagnoses_policy_version_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.weakness_diagnoses
    ADD CONSTRAINT weakness_diagnoses_policy_version_fkey FOREIGN KEY (policy_version) REFERENCES skill_trainer.learning_policy_versions(policy_version);


--
-- Name: weakness_diagnoses weakness_diagnoses_skill_id_fkey; Type: FK CONSTRAINT; Schema: skill_trainer; Owner: -
--

ALTER TABLE ONLY skill_trainer.weakness_diagnoses
    ADD CONSTRAINT weakness_diagnoses_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES skill_trainer.skill_concepts(id);


--
-- PostgreSQL database dump complete
--

--
-- 能力の一覧。能力を持つ列は、ここを FK で指す。
--

CREATE TABLE skill_trainer.capabilities (
    code character varying(40) PRIMARY KEY,
    label text NOT NULL
);

INSERT INTO skill_trainer.capabilities (code, label) VALUES
    ('CONTROLLED_RECALL', '日本語から英語を言う'),
    ('RECOGNITION', '英語を見て意味が分かる'),
    ('SLOT_REPLACEMENT', '型の一部を入れ替える'),
    ('CONTRAST_SELECTION', '似た形から正しい方を選ぶ'),
    ('FREE_PRODUCTION', '自分のことを自由に言う'),
    ('RETENTION_1D', '1 日後に思い出す'),
    ('RETENTION_7D', '7 日後に思い出す'),
    ('RETENTION_30D', '30 日後に思い出す'),
    ('CONVERSATION_USAGE', '会話の中で使う');

ALTER TABLE ONLY skill_trainer.exercise_definitions
    ADD CONSTRAINT exercise_definitions_capability_fkey FOREIGN KEY (target_capability) REFERENCES skill_trainer.capabilities(code);
ALTER TABLE ONLY skill_trainer.exercises
    ADD CONSTRAINT exercises_capability_fkey FOREIGN KEY (target_capability) REFERENCES skill_trainer.capabilities(code);
ALTER TABLE ONLY skill_trainer.capability_evidence
    ADD CONSTRAINT capability_evidence_capability_fkey FOREIGN KEY (capability) REFERENCES skill_trainer.capabilities(code);
ALTER TABLE ONLY skill_trainer.quiz_items
    ADD CONSTRAINT quiz_items_capability_fkey FOREIGN KEY (capability) REFERENCES skill_trainer.capabilities(code);
ALTER TABLE ONLY skill_trainer.quiz_attempts
    ADD CONSTRAINT quiz_attempts_capability_fkey FOREIGN KEY (capability) REFERENCES skill_trainer.capabilities(code);
ALTER TABLE ONLY skill_trainer.training_plan_items
    ADD CONSTRAINT training_plan_items_capability_fkey FOREIGN KEY (target_capability) REFERENCES skill_trainer.capabilities(code);
ALTER TABLE ONLY skill_trainer.weakness_diagnoses
    ADD CONSTRAINT weakness_diagnoses_capability_fkey FOREIGN KEY (target_capability) REFERENCES skill_trainer.capabilities(code);

--
-- 混同ペアは教材だけを持つ。同じ二つのラベルのペアは 1 つだけ。
--

CREATE UNIQUE INDEX confusion_pairs_labels_idx ON skill_trainer.confusion_pairs USING btree (label_a, label_b);

ALTER TABLE ONLY skill_trainer.confusion_pairs
    ADD CONSTRAINT confusion_pairs_skill_key_a_fkey FOREIGN KEY (skill_key_a) REFERENCES skill_trainer.skill_concepts(stable_key);
ALTER TABLE ONLY skill_trainer.confusion_pairs
    ADD CONSTRAINT confusion_pairs_skill_key_b_fkey FOREIGN KEY (skill_key_b) REFERENCES skill_trainer.skill_concepts(stable_key);

--
-- 学習者ごとの混同ペアの状態。教材の行（confusion_pairs）とは分ける。
--

CREATE TABLE skill_trainer.learner_confusion_state (
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    pair_id uuid NOT NULL REFERENCES skill_trainer.confusion_pairs(pair_id),
    confusion_count integer DEFAULT 0 NOT NULL CHECK (confusion_count >= 0),
    graded_count integer DEFAULT 0 NOT NULL CHECK (graded_count >= 0),
    success_count integer DEFAULT 0 NOT NULL CHECK (success_count >= 0),
    success_streak integer DEFAULT 0 NOT NULL CHECK (success_streak >= 0),
    pending_sides jsonb DEFAULT '[]'::jsonb NOT NULL CHECK (jsonb_typeof(pending_sides) = 'array'),
    serving_probe_id uuid REFERENCES skill_trainer.confusion_probes(probe_id),
    next_due_at timestamp with time zone,
    first_observed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (learner_key, pair_id)
);

CREATE INDEX learner_confusion_state_due_idx ON skill_trainer.learner_confusion_state USING btree (learner_key, next_due_at);

CREATE TABLE skill_trainer.learner_probe_state (
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    probe_id uuid NOT NULL REFERENCES skill_trainer.confusion_probes(probe_id),
    last_served_at timestamp with time zone NOT NULL,
    PRIMARY KEY (learner_key, probe_id)
);

--
-- 教材と状態を合わせて読むためのビュー。状態が無いペアは、まだ一度も出ていないペアとして読む。
--

CREATE VIEW skill_trainer.learner_confusion_pairs AS
 SELECT cp.pair_id,
    learner.learner_key,
    cp.label_a,
    cp.label_b,
    cp.skill_key_a,
    cp.skill_key_b,
    cp.key_a,
    cp.direction_a,
    cp.key_b,
    cp.direction_b,
    cp.source,
    cp.confusion_type,
    cp.created_at,
    COALESCE(st.confusion_count, 0) AS confusion_count,
    COALESCE(st.graded_count, 0) AS graded_count,
    COALESCE(st.success_count, 0) AS success_count,
    COALESCE(st.success_streak, 0) AS success_streak,
    COALESCE(st.pending_sides, '[]'::jsonb) AS pending_sides,
    st.serving_probe_id,
    st.next_due_at,
    st.first_observed_at
   FROM skill_trainer.confusion_pairs cp
     CROSS JOIN (SELECT 'default'::character varying(80) AS learner_key) learner
     LEFT JOIN skill_trainer.learner_confusion_state st
       ON st.pair_id = cp.pair_id AND st.learner_key = learner.learner_key;

--
-- AI の呼び出しごとの使用量。利用上限の判定に使う。
--

CREATE TABLE skill_trainer.ai_usage (
    id bigserial PRIMARY KEY,
    learner_key character varying(80) DEFAULT 'default'::character varying NOT NULL,
    feature character varying(40) NOT NULL,
    model character varying(80) NOT NULL,
    input_tokens integer NOT NULL CHECK (input_tokens >= 0),
    output_tokens integer NOT NULL CHECK (output_tokens >= 0),
    cost_usd numeric(10, 6) NOT NULL CHECK (cost_usd >= 0),
    called_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX ai_usage_learner_called_idx ON skill_trainer.ai_usage USING btree (learner_key, called_at DESC);

--
-- learner_settings は学習者ごとの設定。
--

ALTER TABLE ONLY skill_trainer.learner_settings
    ALTER COLUMN learner_key TYPE character varying(80);

--
-- よく通る経路の索引。
--

CREATE INDEX training_attempts_exercise_idx ON skill_trainer.training_attempts USING btree (exercise_id, occurred_at DESC);
CREATE INDEX training_attempts_instance_idx ON skill_trainer.training_attempts USING btree (exercise_instance_id);
CREATE INDEX training_attempts_plan_item_idx ON skill_trainer.training_attempts USING btree (plan_item_id);
CREATE INDEX training_attempts_learner_occurred_idx ON skill_trainer.training_attempts USING btree (learner_key, occurred_at DESC);
CREATE INDEX capability_evidence_attempt_idx ON skill_trainer.capability_evidence USING btree (training_attempt_id);
CREATE INDEX capability_evidence_grading_idx ON skill_trainer.capability_evidence USING btree (grading_id);
CREATE INDEX capability_evidence_learner_observed_idx ON skill_trainer.capability_evidence USING btree (learner_key, observed_at DESC);
CREATE INDEX grading_observations_turn_idx ON skill_trainer.grading_observations USING btree (conversation_turn_id);
CREATE INDEX confusion_events_pair_idx ON skill_trainer.confusion_events USING btree (pair_id, created_at DESC);
CREATE INDEX confusion_probes_pair_idx ON skill_trainer.confusion_probes USING btree (pair_id, side, ordinal);
CREATE INDEX rendered_exercises_plan_item_idx ON skill_trainer.rendered_exercises USING btree (plan_item_id);
CREATE INDEX rendered_exercises_definition_idx ON skill_trainer.rendered_exercises USING btree (exercise_key, exercise_version);
CREATE INDEX quiz_items_skill_idx ON skill_trainer.quiz_items USING btree (skill_id);
CREATE INDEX quiz_items_pair_idx ON skill_trainer.quiz_items USING btree (pair_id);

--
-- 教材以外の初期値。
--

INSERT INTO skill_trainer.domains (id, code, display_name) VALUES (1, 'english_conversation', '英会話');
SELECT pg_catalog.setval('skill_trainer.domains_id_seq', 1, true);

INSERT INTO skill_trainer.domain_categories (domain_id, category_code) VALUES
    (1, 'OUTPUT'), (1, 'QUERY'), (1, 'TIME'), (1, 'ACTION'), (1, 'ERROR_HANDLING');

INSERT INTO skill_trainer.learner_settings (learner_key, ai_enabled) VALUES ('default', true);

-- 採点契約は採点の版ごとに 1 つ。練習問題は rubric の版から契約を決める（rubric:<版>）。
INSERT INTO skill_trainer.assessment_contracts
    (contract_key, version, required_dimensions, response_modes, deterministic_policy, ai_observation_schema, evidence_policy, domain_id)
VALUES
    ('quiz-choice', 1, '[]', '["choice"]', '{"kind": "selected_option_equals_correct_option"}', NULL, 'no_evidence', 1),
    ('confusion-probe', 1, '[]', '["confusion_probe"]', '{"kind": "normalized_text_equals_expected_text"}', NULL, 'no_evidence', 1);

INSERT INTO skill_trainer.assessment_contracts
    (contract_key, version, required_dimensions, response_modes, deterministic_policy, ai_observation_schema, evidence_policy, domain_id)
SELECT 'rubric:' || rubric.version, 1, rubric.dimensions::jsonb, '["free_text"]',
       '{"kind": "normalized_exact_or_accepted_variant", "accepted_variants": true, "expected_reference": true}',
       '{"meaning_match": "boolean", "speech_act_match": "boolean", "comprehensibility": "enum", "target_pattern_status": "enum", "issues": "fact_array"}',
       'versioned_reducer', 1
FROM (VALUES
    ('controlled-recall-v1', '["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]'),
    ('controlled-recall-v2', '["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]'),
    ('recognition-v1', '["communication", "semantic", "intent", "policy"]'),
    ('slot-replacement-v1', '["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]'),
    ('contrast-drill-v1', '["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]'),
    ('free-production-v1', '["communication", "semantic", "intent", "policy", "target_skill_usage"]'),
    ('retention-1d-v1', '["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]'),
    ('retention-7d-v1', '["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]'),
    ('retention-30d-v1', '["communication", "semantic", "intent", "form", "policy", "target_skill_usage"]')
) AS rubric(version, dimensions);

INSERT INTO skill_trainer.learning_policy_versions (policy_version, status, config, effective_at) VALUES
    ('phase1-adaptive-v1', 'retired', '{"dose": 1, "output_style": "POLITE_NEUTRAL", "planner_budget": {"Train": 2, "Verify": 1, "Measure": 2}, "min_graded_count": 3, "target_success_rate": 0.8, "evidence_window_days": 30, "target_p50_latency_ms": 3000}', '2026-10-08 00:00:00+09'),
    ('phase1-adaptive-v2', 'active', '{"dose": 1, "output_style": "POLITE_NEUTRAL", "planner_budget": {"Train": 2, "Verify": 1, "Measure": 2}, "retention_days": [1, 7, 30], "min_graded_count": 3, "target_success_rate": 0.8, "evidence_window_days": 30, "target_p50_latency_ms": 3000}', '2026-10-12 00:00:00+09');

INSERT INTO skill_trainer.learner_phase_gate_policies (phase, version, requirements, required_scenarios, effective_at) VALUES
    (1, 'phase1-gate-draft-v1', '[{"metric": "success_rate", "threshold": 0.8, "capability": "CONTROLLED_RECALL", "comparator": ">=", "window_days": 30, "min_graded_count": 3}, {"metric": "p50_latency_ms", "threshold": 3000, "capability": "CONTROLLED_RECALL", "comparator": "<=", "window_days": 30, "min_graded_count": 3}]', '[]', '2026-10-08 00:00:00+09'),
    (1, 'phase1-gate-v1', '[{"metric": "success_rate", "threshold": 0.8, "capability": "CONTROLLED_RECALL", "comparator": ">=", "window_days": 30, "min_graded_count": 5}, {"metric": "p50_latency_ms", "threshold": 3000, "capability": "CONTROLLED_RECALL", "comparator": "<=", "window_days": 30, "min_graded_count": 5}, {"metric": "success_rate", "threshold": 0.85, "capability": "RECOGNITION", "comparator": ">=", "window_days": 30, "min_graded_count": 5}, {"metric": "success_rate", "threshold": 0.8, "capability": "SLOT_REPLACEMENT", "comparator": ">=", "window_days": 30, "min_graded_count": 3}, {"metric": "success_rate", "threshold": 0.8, "capability": "CONTRAST_SELECTION", "comparator": ">=", "window_days": 30, "min_graded_count": 3}, {"metric": "success_rate", "threshold": 0.7, "capability": "FREE_PRODUCTION", "comparator": ">=", "window_days": 30, "min_graded_count": 3}, {"metric": "success_rate", "threshold": 0.7, "capability": "CONVERSATION_USAGE", "comparator": ">=", "window_days": 30, "min_graded_count": 5}, {"metric": "success_rate", "threshold": 0.8, "capability": "RETENTION_7D", "comparator": ">=", "window_days": 30, "min_graded_count": 3}]', '[{"scenario": "teacher", "min_self_questions": 5, "min_duration_seconds": 600}, {"scenario": "learner", "min_self_questions": 5, "min_duration_seconds": 600}, {"scenario": "free_talk", "min_self_questions": 5, "min_duration_seconds": 600}]', '2026-10-12 00:00:00+09'),
    (1, 'phase1-gate-v2', '[{"metric": "success_rate", "threshold": 0.8, "capability": "CONTROLLED_RECALL", "comparator": ">=", "window_days": 30, "min_graded_count": 10, "min_distinct_skills": 10}, {"metric": "p50_latency_ms", "threshold": 3000, "capability": "CONTROLLED_RECALL", "comparator": "<=", "window_days": 30, "min_graded_count": 10, "min_distinct_skills": 10}, {"metric": "success_rate", "threshold": 0.85, "capability": "RECOGNITION", "comparator": ">=", "window_days": 30, "min_graded_count": 10, "min_distinct_skills": 10}, {"metric": "success_rate", "threshold": 0.8, "capability": "SLOT_REPLACEMENT", "comparator": ">=", "window_days": 30, "min_graded_count": 5, "min_distinct_skills": 5}, {"metric": "success_rate", "threshold": 0.8, "capability": "CONTRAST_SELECTION", "comparator": ">=", "window_days": 30, "min_graded_count": 5, "min_distinct_skills": 5}, {"metric": "success_rate", "threshold": 0.7, "capability": "FREE_PRODUCTION", "comparator": ">=", "window_days": 30, "min_graded_count": 5, "min_distinct_skills": 5}, {"metric": "success_rate", "threshold": 0.7, "capability": "CONVERSATION_USAGE", "comparator": ">=", "window_days": 30, "min_graded_count": 5, "min_distinct_skills": 5}, {"metric": "success_rate", "threshold": 0.8, "capability": "RETENTION_7D", "comparator": ">=", "window_days": 30, "min_graded_count": 5, "min_distinct_skills": 5}]', '[{"scenario": "teacher", "min_self_questions": 5, "min_duration_seconds": 600}, {"scenario": "learner", "min_self_questions": 5, "min_duration_seconds": 600}, {"scenario": "free_talk", "min_self_questions": 5, "min_duration_seconds": 600}]', '2026-10-12 12:00:00+09');
