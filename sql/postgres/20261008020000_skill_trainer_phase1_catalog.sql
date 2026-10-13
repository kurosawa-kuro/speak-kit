-- Phase 1 adaptive catalog completion.
--
-- The owner directive on 2026-10-08 approved closing the remaining Phase 1
-- work. Legacy rows remain immutable history; this migration records an
-- explicit reviewed mapping from each legacy example to an abstract Skill (or
-- an atomic chunk) and creates versioned Exercises for every Phase 1 mode.

CREATE TEMP TABLE phase1_skill_mapping (
    legacy_external_id VARCHAR(50) PRIMARY KEY,
    stable_key         VARCHAR(100) NOT NULL,
    canonical_form     VARCHAR(255) NOT NULL,
    meaning            TEXT NOT NULL,
    category           VARCHAR(20) NOT NULL,
    intent             VARCHAR(50),
    tier               VARCHAR(20) NOT NULL,
    concept_kind       VARCHAR(20) NOT NULL
) ON COMMIT DROP;

INSERT INTO phase1_skill_mapping VALUES
  ('P1-001','SELF_DESCRIPTION_BE','I am {role_or_state}.','自分の役割・状態を述べる','OUTPUT','SELF_DESCRIPTION','CORE','pattern'),
  ('P1-002','PREFERENCE_LIKE_GERUND','I like {activity}.','好みを述べる','OUTPUT','PREFERENCE','CORE','pattern'),
  ('P1-003','DESIRE_WANT_TO','I want to {verb_phrase}.','したいことを述べる','OUTPUT','DESIRE','CORE','pattern'),
  ('P1-004','REASON_BECAUSE','{result} because {reason}.','理由を添えて述べる','OUTPUT','REASON','CORE','pattern'),
  ('P1-005','DURATION_IT_TOOK','It took me {duration} to {verb_phrase}.','所要時間を述べる','OUTPUT','HISTORY','CORE','pattern'),
  ('P1-006','CAUSE_THATS_WHY','That''s why {result}.','理由を受けて結論を述べる','OUTPUT','CONCLUSION_REASON','CORE','pattern'),
  ('P1-007','PERSONAL_CASE','In my case, {statement}.','自分の場合を述べる','OUTPUT','PERSONAL_CASE','CORE','pattern'),
  ('P1-008','NO_CHOICE_BUT','I had no choice but to {verb_phrase}.','他に選択肢がなかったことを述べる','OUTPUT','NO_CHOICE','CORE','pattern'),
  ('P1-009','PAST_VS_NOW','I used to {past}, but now {present}.','過去と現在を対比する','OUTPUT','PAST_VS_NOW','CORE','pattern'),
  ('P1-010','CORRECTION_MEAN','I don''t mean {a}. I mean {b}.','誤解を訂正する','OUTPUT','CORRECTION','CORE','pattern'),
  ('P1-011','QUESTION_PRESENT_DO','Do you {verb_phrase}?','現在の習慣・事実を質問する','QUERY','PRESENT_YES_NO','CORE','pattern'),
  ('P1-012','QUESTION_PAST_DID','Did you {verb_phrase}?','過去の行動を質問する','QUERY','PAST_YES_NO','CORE','pattern'),
  ('P1-013','QUESTION_STATE_ARE','Are you {state}?','相手の状態を質問する','QUERY','STATE_YES_NO','CORE','pattern'),
  ('P1-014','QUESTION_FAVORITE_WHAT','What is your favorite {topic}?','相手の好みを質問する','QUERY','DETAIL_WHAT','CORE','pattern'),
  ('P1-015','QUESTION_REASON_WHY','Why {clause}?','理由を質問する','QUERY','REASON_WHY','CORE','pattern'),
  ('P1-016','QUESTION_STATE_HOW','How was {event_or_period}?','出来事や期間の様子を質問する','QUERY','STATE_HOW','CORE','pattern'),
  ('P1-017','QUESTION_EXPERIENCE_HAVE_EVER','Have you ever {past_participle}?','経験を質問する','QUERY','EXPERIENCE','CORE','pattern'),
  ('P1-018','QUESTION_BACK_HOW_ABOUT_YOU','How about you?','相手へ質問を返す','QUERY','QUESTION_BACK','CORE','atomic_chunk'),
  ('P1-019','TIME_USUALLY','I usually {verb_phrase}.','習慣を述べる','TIME','USUAL','CORE','pattern'),
  ('P1-020','TIME_PAST_YESTERDAY','I {past_action} yesterday.','過去の出来事を述べる','TIME','PAST','CORE','pattern'),
  ('P1-021','TIME_PRESENT_PROGRESSIVE_NOW','I am {verb_ing} now.','今していることを述べる','TIME','NOW','CORE','pattern'),
  ('P1-022','TIME_FUTURE_GOING_TO','I am going to {verb_phrase}.','予定を述べる','TIME','FUTURE','CORE','pattern'),
  ('P1-023','TIME_EXPERIENCE_HAVE_BEEN','I have been to {place}.','訪問経験を述べる','TIME','EXPERIENCE','CORE','pattern'),
  ('P1-024','PERMISSION_COULD_I','Could I {verb_phrase}?','丁寧に許可を求める','ACTION','PERMISSION','CORE','pattern'),
  ('P1-025','REQUEST_COULD_YOU','Could you {verb_phrase}?','相手に丁寧に行動を依頼する','ACTION','REQUEST','CORE','pattern'),
  ('P1-026','INVITATION_WOULD_YOU_LIKE','Would you like to {verb_phrase}?','丁寧に誘う','ACTION','INVITATION','CORE','pattern'),
  ('P1-027','SUGGESTION_HOW_ABOUT','How about {proposal}?','候補を提案する','ACTION','SUGGESTION','CORE','pattern'),
  ('P1-028','REPEAT_REQUEST','Could you say that again?','聞き取れない時に繰り返しを依頼する','ERROR_HANDLING','REPEAT_REQUEST','CORE','atomic_chunk'),
  ('P1-029','MEANING_CLARIFICATION','What does that mean?','意味を確認する','ERROR_HANDLING','MEANING_CHECK','CORE','atomic_chunk'),
  ('P1-030','MEANING_CONFIRMATION','Do you mean {interpretation}?','理解が合っているか確認する','ERROR_HANDLING','CONFIRMATION','CORE','pattern'),
  ('P1-031','CHUNK_GET_HOME','get home','家に着く','ACTION','DAILY_LIFE','TIER1','atomic_chunk'),
  ('P1-032','CHUNK_GET_TIRED','get tired','疲れる','ACTION','STATE_CHANGE','TIER1','atomic_chunk'),
  ('P1-033','CHUNK_GET_BETTER','get better','良くなる','ACTION','STATE_CHANGE','TIER1','atomic_chunk'),
  ('P1-034','CHUNK_GET_READY','get ready','準備する','ACTION','DAILY_LIFE','TIER1','atomic_chunk'),
  ('P1-035','CHUNK_TAKE_SHOWER','take a shower','シャワーを浴びる','ACTION','DAILY_LIFE','TIER1','atomic_chunk'),
  ('P1-036','CHUNK_TAKE_BREAK','take a break','休憩する','ACTION','DAILY_LIFE','TIER1','atomic_chunk'),
  ('P1-037','CHUNK_TAKE_BUS','take a bus','バスに乗る','ACTION','TRANSPORT','TIER1','atomic_chunk'),
  ('P1-038','CHUNK_TAKE_MEDICINE','take medicine','薬を飲む','ACTION','DAILY_LIFE','TIER1','atomic_chunk'),
  ('P1-039','CHUNK_HAVE_BREAKFAST','have breakfast','朝食をとる','ACTION','DAILY_LIFE','TIER1','atomic_chunk'),
  ('P1-040','CHUNK_HAVE_TIME','have time','時間がある','ACTION','AVAILABILITY','TIER1','atomic_chunk'),
  ('P1-041','CHUNK_HAVE_FUN','have fun','楽しむ','ACTION','ENJOYMENT','TIER1','atomic_chunk'),
  ('P1-042','CHUNK_HAVE_PROBLEM','have a problem','問題がある','ACTION','PROBLEM','TIER1','atomic_chunk'),
  ('P1-043','CHUNK_GO_HOME','go home','帰る','ACTION','DAILY_LIFE','TIER1','atomic_chunk'),
  ('P1-044','CHUNK_GO_SHOPPING','go shopping','買い物に行く','ACTION','DAILY_LIFE','TIER1','atomic_chunk'),
  ('P1-045','CHUNK_GO_OUT','go out','出かける','ACTION','DAILY_LIFE','TIER1','atomic_chunk'),
  ('P1-046','CHUNK_GO_WRONG','go wrong','うまくいかない','ACTION','PROBLEM','TIER1','atomic_chunk'),
  ('P1-047','CHUNK_FEEL_TIRED','feel tired','疲れを感じる','ACTION','FEELING','TIER1','atomic_chunk'),
  ('P1-048','CHUNK_FEEL_BETTER','feel better','気分・体調が良くなる','ACTION','FEELING','TIER1','atomic_chunk'),
  ('P1-049','CHUNK_FEEL_GOOD','feel good','気分がいい','ACTION','FEELING','TIER1','atomic_chunk'),
  ('P1-050','CHUNK_FEEL_LIKE','feel like {noun_or_verb_ing}','何かをしたい気分を述べる','ACTION','DESIRE','TIER1','pattern');

INSERT INTO skill_trainer.skill_concepts
  (stable_key, canonical_form, meaning, category, intent, phase, tier, direction,
   concept_kind, review_source)
SELECT DISTINCT ON (stable_key)
       stable_key, canonical_form, meaning, category, intent, 1, tier, 'OUTPUT',
       concept_kind, 'owner residual-zero directive 2026-10-08'
FROM phase1_skill_mapping
ORDER BY stable_key, legacy_external_id
ON CONFLICT (stable_key) DO NOTHING;

UPDATE skill_trainer.legacy_skill_migration_decisions d
SET target_skill_stable_key = m.stable_key,
    target_canonical_form = m.canonical_form,
    exercise_key = m.legacy_external_id || '-CR',
    exercise_version = 1,
    migration_decision = 'approved',
    review_note = 'Reviewed mapping: abstract Skill/atomic chunk is separate from the concrete legacy example.',
    reviewed_at = TIMESTAMPTZ '2026-10-08 00:00:00+09'
FROM phase1_skill_mapping m
WHERE d.legacy_external_id = m.legacy_external_id;

-- Controlled Recall: concrete Japanese prompt and complete English reference.
INSERT INTO skill_trainer.exercise_definitions
  (exercise_key, version, training_mode, target_skill_id, target_capability,
   prompt_spec, reference_examples, accepted_variants, rubric, difficulty,
   modality, status, content_hash)
SELECT d.legacy_external_id || '-CR', 1, 'controlled_recall', sc.id, 'CONTROLLED_RECALL',
       jsonb_build_object('prompt', d.legacy_japanese),
       jsonb_build_array(d.legacy_english), '[]'::jsonb,
       '{"rubric_version":"controlled-recall-v2","required_dimensions":["communication","semantic","intent","form","policy","target_skill_usage"]}'::jsonb,
       CASE WHEN sc.tier = 'CORE' THEN 2 ELSE 1 END, 'text', 'active',
       md5(d.legacy_external_id || '|cr|' || d.legacy_english) || md5('v2|' || d.legacy_external_id || '|cr')
FROM skill_trainer.legacy_skill_migration_decisions d
JOIN skill_trainer.skill_concepts sc ON sc.stable_key = d.target_skill_stable_key
WHERE d.migration_decision = 'approved'
ON CONFLICT (exercise_key, version) DO NOTHING;

-- Recognition observes meaning without requiring English production.
INSERT INTO skill_trainer.exercise_definitions
  (exercise_key, version, training_mode, target_skill_id, target_capability,
   prompt_spec, reference_examples, accepted_variants, rubric, difficulty,
   modality, status, content_hash)
SELECT d.legacy_external_id || '-RG', 1, 'recognition', sc.id, 'RECOGNITION',
       jsonb_build_object('prompt', '次の英文の意味を日本語で答えてください: ' || d.legacy_english),
       jsonb_build_array(d.legacy_japanese), '[]'::jsonb,
       '{"rubric_version":"recognition-v1","required_dimensions":["communication","semantic","intent","policy"]}'::jsonb,
       CASE WHEN sc.tier = 'CORE' THEN 2 ELSE 1 END, 'text', 'active',
       md5(d.legacy_external_id || '|rg|' || d.legacy_japanese) || md5('v1|' || d.legacy_external_id || '|rg')
FROM skill_trainer.legacy_skill_migration_decisions d
JOIN skill_trainer.skill_concepts sc ON sc.stable_key = d.target_skill_stable_key
WHERE d.migration_decision = 'approved'
ON CONFLICT (exercise_key, version) DO NOTHING;

-- Pattern substitution is meaningful only for reusable pattern Skills.
INSERT INTO skill_trainer.exercise_definitions
  (exercise_key, version, training_mode, target_skill_id, target_capability,
   prompt_spec, reference_examples, accepted_variants, rubric, difficulty,
   modality, status, content_hash)
SELECT d.legacy_external_id || '-SR', 1, 'slot_replacement', sc.id, 'SLOT_REPLACEMENT',
       jsonb_build_object('prompt', '指定された型を使い、次を英語にしてください: ' || d.legacy_japanese),
       jsonb_build_array(d.legacy_english), '[]'::jsonb,
       '{"rubric_version":"slot-replacement-v1","required_dimensions":["communication","semantic","intent","form","policy","target_skill_usage"]}'::jsonb,
       2, 'text', 'active',
       md5(d.legacy_external_id || '|sr|' || d.legacy_english) || md5('v1|' || d.legacy_external_id || '|sr')
FROM skill_trainer.legacy_skill_migration_decisions d
JOIN skill_trainer.skill_concepts sc ON sc.stable_key = d.target_skill_stable_key
WHERE d.migration_decision = 'approved' AND sc.concept_kind = 'pattern'
ON CONFLICT (exercise_key, version) DO NOTHING;

-- Contrast exercises cover the tense/question/action distinctions that are
-- confusable in Phase 1. The answer remains a complete sentence.
INSERT INTO skill_trainer.exercise_definitions
  (exercise_key, version, training_mode, target_skill_id, target_capability,
   prompt_spec, reference_examples, accepted_variants, rubric, difficulty,
   modality, status, content_hash)
SELECT d.legacy_external_id || '-CD', 1, 'contrast_drill', sc.id, 'CONTRAST_SELECTION',
       jsonb_build_object('prompt', '時制・意図の違いに注意して英語全文で答えてください: ' || d.legacy_japanese),
       jsonb_build_array(d.legacy_english), '[]'::jsonb,
       '{"rubric_version":"contrast-drill-v1","required_dimensions":["communication","semantic","intent","form","policy","target_skill_usage"]}'::jsonb,
       3, 'text', 'active',
       md5(d.legacy_external_id || '|cd|' || d.legacy_english) || md5('v1|' || d.legacy_external_id || '|cd')
FROM skill_trainer.legacy_skill_migration_decisions d
JOIN skill_trainer.skill_concepts sc ON sc.stable_key = d.target_skill_stable_key
WHERE d.legacy_external_id IN (
  'P1-011','P1-012','P1-013','P1-017','P1-019','P1-020','P1-021','P1-022','P1-023',
  'P1-024','P1-025','P1-026','P1-027'
)
ON CONFLICT (exercise_key, version) DO NOTHING;

-- Free Production asks for an original sentence while retaining a reference,
-- so a grader may decline per-Skill attribution when target usage is absent.
INSERT INTO skill_trainer.exercise_definitions
  (exercise_key, version, training_mode, target_skill_id, target_capability,
   prompt_spec, reference_examples, accepted_variants, rubric, difficulty,
   modality, status, content_hash)
SELECT d.legacy_external_id || '-FP', 1, 'free_production', sc.id, 'FREE_PRODUCTION',
       jsonb_build_object('prompt', 'この用途を使い、あなた自身について英語1文で答えてください: ' || sc.meaning),
       jsonb_build_array(d.legacy_english), '[]'::jsonb,
       '{"rubric_version":"free-production-v1","required_dimensions":["communication","semantic","intent","policy","target_skill_usage"]}'::jsonb,
       3, 'text', 'active',
       md5(d.legacy_external_id || '|fp|' || d.legacy_english) || md5('v1|' || d.legacy_external_id || '|fp')
FROM skill_trainer.legacy_skill_migration_decisions d
JOIN skill_trainer.skill_concepts sc ON sc.stable_key = d.target_skill_stable_key
WHERE d.migration_decision = 'approved' AND sc.tier = 'CORE'
ON CONFLICT (exercise_key, version) DO NOTHING;

-- Retention probes are distinct Exercises and Capabilities; no Retention value
-- exists until the corresponding due probe is actually graded.
INSERT INTO skill_trainer.exercise_definitions
  (exercise_key, version, training_mode, target_skill_id, target_capability,
   prompt_spec, reference_examples, accepted_variants, rubric, difficulty,
   modality, status, content_hash)
SELECT d.legacy_external_id || '-RT-' || probe.label, 1, 'spaced_retrieval', sc.id,
       probe.capability,
       jsonb_build_object('prompt', d.legacy_japanese),
       jsonb_build_array(d.legacy_english), '[]'::jsonb,
       jsonb_build_object(
         'rubric_version', 'retention-' || lower(probe.label) || '-v1',
         'required_dimensions', jsonb_build_array('communication','semantic','intent','form','policy','target_skill_usage'),
         'retention_days', probe.days
       ),
       CASE WHEN probe.days = 1 THEN 2 WHEN probe.days = 7 THEN 3 ELSE 4 END,
       'text', 'active',
       md5(d.legacy_external_id || '|rt|' || probe.label) || md5('v1|' || d.legacy_external_id || '|rt|' || probe.label)
FROM skill_trainer.legacy_skill_migration_decisions d
JOIN skill_trainer.skill_concepts sc ON sc.stable_key = d.target_skill_stable_key
CROSS JOIN (VALUES
  ('1D','RETENTION_1D',1), ('7D','RETENTION_7D',7), ('30D','RETENTION_30D',30)
) AS probe(label, capability, days)
WHERE d.migration_decision = 'approved'
ON CONFLICT (exercise_key, version) DO NOTHING;

-- Idempotent v2 Talk identity. Existing v1 rows remain readable and are not
-- rewritten; new user turns carry a client UUID.
ALTER TABLE skill_trainer.conversation_turns
  ADD COLUMN IF NOT EXISTS client_turn_id UUID;

ALTER TABLE skill_trainer.conversation_sessions
  ADD COLUMN IF NOT EXISTS candidate_extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metrics_version VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_sessions_session_id_idx
  ON skill_trainer.conversation_sessions (session_id);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_turns_client_turn_id_idx
  ON skill_trainer.conversation_turns (client_turn_id)
  WHERE client_turn_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS grading_observations_one_adopted_turn_idx
  ON skill_trainer.grading_observations (conversation_turn_id)
  WHERE conversation_turn_id IS NOT NULL AND adopted_for_evidence = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS capability_evidence_one_turn_capability_idx
  ON skill_trainer.capability_evidence (conversation_turn_id, skill_id, capability)
  WHERE conversation_turn_id IS NOT NULL;

ALTER TABLE skill_trainer.candidate_skills
  ADD COLUMN IF NOT EXISTS promoted_skill_id BIGINT REFERENCES skill_trainer.skill_concepts(id),
  ADD COLUMN IF NOT EXISTS promotion_snapshot JSONB;

UPDATE skill_trainer.learning_policy_versions
SET status = 'retired'
WHERE status = 'active' AND policy_version <> 'phase1-adaptive-v2';

-- An old one-item plan must not survive the policy cutover. Its Attempts and
-- Evidence stay immutable; only the executable plan is superseded.
UPDATE skill_trainer.training_plans
SET status = 'superseded'
WHERE status = 'active' AND policy_version <> 'phase1-adaptive-v2';

INSERT INTO skill_trainer.learning_policy_versions
  (policy_version, status, config, effective_at)
VALUES (
  'phase1-adaptive-v2', 'active',
  '{
    "evidence_window_days": 30,
    "min_graded_count": 3,
    "target_success_rate": 0.8,
    "target_p50_latency_ms": 3000,
    "planner_budget": {"Measure": 2, "Train": 2, "Verify": 1},
    "dose": 1,
    "output_style": "POLITE_NEUTRAL",
    "retention_days": [1, 7, 30]
  }'::jsonb,
  '2026-10-08T00:00:00+09:00'
) ON CONFLICT (policy_version) DO NOTHING;

INSERT INTO skill_trainer.learner_phase_gate_policies
  (phase, version, requirements, required_scenarios, effective_at)
VALUES (
  1, 'phase1-gate-v1',
  '[
    {"capability":"CONTROLLED_RECALL","metric":"success_rate","window_days":30,"min_graded_count":5,"comparator":">=","threshold":0.8},
    {"capability":"CONTROLLED_RECALL","metric":"p50_latency_ms","window_days":30,"min_graded_count":5,"comparator":"<=","threshold":3000},
    {"capability":"RECOGNITION","metric":"success_rate","window_days":30,"min_graded_count":5,"comparator":">=","threshold":0.85},
    {"capability":"SLOT_REPLACEMENT","metric":"success_rate","window_days":30,"min_graded_count":3,"comparator":">=","threshold":0.8},
    {"capability":"CONTRAST_SELECTION","metric":"success_rate","window_days":30,"min_graded_count":3,"comparator":">=","threshold":0.8},
    {"capability":"FREE_PRODUCTION","metric":"success_rate","window_days":30,"min_graded_count":3,"comparator":">=","threshold":0.7},
    {"capability":"CONVERSATION_USAGE","metric":"success_rate","window_days":30,"min_graded_count":5,"comparator":">=","threshold":0.7},
    {"capability":"RETENTION_7D","metric":"success_rate","window_days":30,"min_graded_count":3,"comparator":">=","threshold":0.8}
  ]'::jsonb,
  '[
    {"scenario":"teacher","min_duration_seconds":600,"min_self_questions":5},
    {"scenario":"learner","min_duration_seconds":600,"min_self_questions":5},
    {"scenario":"free_talk","min_duration_seconds":600,"min_self_questions":5}
  ]'::jsonb,
  NOW()
) ON CONFLICT (phase, version) DO NOTHING;

ALTER TABLE skill_trainer.conversation_turns OWNER TO job_control_api;
ALTER TABLE skill_trainer.candidate_skills OWNER TO job_control_api;
ALTER INDEX skill_trainer.conversation_sessions_session_id_idx OWNER TO job_control_api;
ALTER INDEX skill_trainer.conversation_turns_client_turn_id_idx OWNER TO job_control_api;
ALTER INDEX skill_trainer.grading_observations_one_adopted_turn_idx OWNER TO job_control_api;
ALTER INDEX skill_trainer.capability_evidence_one_turn_capability_idx OWNER TO job_control_api;
