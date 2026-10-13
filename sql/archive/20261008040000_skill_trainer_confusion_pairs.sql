-- 混同分離。境界は Skill 単体の誤答回数ではなく、対として残す。
-- Applied by `skill-trainer skill-trainer-local-schema-apply`.

CREATE TABLE IF NOT EXISTS skill_trainer.confusion_pairs (
    pair_id             UUID PRIMARY KEY,
    learner_key         VARCHAR(80) NOT NULL DEFAULT 'default',
    label_a             TEXT NOT NULL,
    label_b             TEXT NOT NULL,
    skill_key_a         VARCHAR(100),
    skill_key_b         VARCHAR(100),
    key_a               TEXT NOT NULL,
    direction_a         TEXT NOT NULL,
    key_b               TEXT NOT NULL,
    direction_b         TEXT NOT NULL,
    source              VARCHAR(30) NOT NULL
      CHECK (source IN ('catalog', 'observed_mistake', 'learner_registered')),
    confusion_count     INTEGER NOT NULL DEFAULT 0 CHECK (confusion_count >= 0),
    graded_count        INTEGER NOT NULL DEFAULT 0 CHECK (graded_count >= 0),
    success_count       INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
    success_streak      INTEGER NOT NULL DEFAULT 0 CHECK (success_streak >= 0),
    pending_sides       JSONB NOT NULL DEFAULT '[]'::jsonb,
    serving_probe_id    UUID,
    next_due_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(pending_sides) = 'array'),
    CHECK (length(label_a) > 0),
    CHECK (length(label_b) > 0),
    CHECK (label_a < label_b)
);

CREATE UNIQUE INDEX IF NOT EXISTS confusion_pairs_labels_idx
  ON skill_trainer.confusion_pairs (learner_key, label_a, label_b);

CREATE TABLE IF NOT EXISTS skill_trainer.confusion_probes (
    probe_id            UUID PRIMARY KEY,
    pair_id             UUID NOT NULL REFERENCES skill_trainer.confusion_pairs(pair_id),
    side                CHAR(1) NOT NULL CHECK (side IN ('a', 'b')),
    ordinal             SMALLINT NOT NULL CHECK (ordinal > 0),
    prompt              TEXT NOT NULL,
    expected_text       TEXT NOT NULL,
    last_served_at      TIMESTAMPTZ,
    CHECK (length(prompt) > 0),
    CHECK (length(expected_text) > 0),
    UNIQUE (pair_id, side, ordinal)
);

CREATE TABLE IF NOT EXISTS skill_trainer.confusion_events (
    event_id            UUID PRIMARY KEY,
    pair_id             UUID NOT NULL REFERENCES skill_trainer.confusion_pairs(pair_id),
    attempt_id          UUID UNIQUE,
    submission_id       UUID UNIQUE,
    probe_id            UUID REFERENCES skill_trainer.confusion_probes(probe_id),
    kind                VARCHAR(20) NOT NULL
      CHECK (kind IN ('mistake', 'probe_success', 'probe_failure')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((attempt_id IS NOT NULL)::int + (submission_id IS NOT NULL)::int = 1)
);

INSERT INTO skill_trainer.confusion_pairs (
    pair_id, learner_key, label_a, label_b, skill_key_a, skill_key_b,
    key_a, direction_a, key_b, direction_b, source
) VALUES (
    '11111111-1111-4111-8111-000000000010',
    'default',
    'because',
    'that''s why',
    'REASON_BECAUSE',
    'CAUSE_THATS_WHY',
    'なぜなら',
    '結果 ← 原因',
    'だから',
    '原因 → 結果',
    'catalog'
) ON CONFLICT (pair_id) DO NOTHING;

INSERT INTO skill_trainer.confusion_probes (probe_id, pair_id, side, ordinal, prompt, expected_text) VALUES
  ('11111111-1111-4111-8111-000000000001', '11111111-1111-4111-8111-000000000010', 'a', 1,
   '雨だったので家にいました。', 'I stayed home because it was raining.'),
  ('11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000010', 'b', 1,
   '雨でした。だから家にいました。', 'It was raining. That''s why I stayed home.'),
  ('11111111-1111-4111-8111-000000000003', '11111111-1111-4111-8111-000000000010', 'a', 2,
   '電車に遅れたので遅刻しました。', 'I was late because I missed the train.'),
  ('11111111-1111-4111-8111-000000000004', '11111111-1111-4111-8111-000000000010', 'b', 2,
   '電車に遅れました。だから遅刻しました。', 'I missed the train. That''s why I was late.')
ON CONFLICT (probe_id) DO NOTHING;

ALTER TABLE skill_trainer.confusion_pairs OWNER TO job_control_api;
ALTER TABLE skill_trainer.confusion_probes OWNER TO job_control_api;
ALTER TABLE skill_trainer.confusion_events OWNER TO job_control_api;
