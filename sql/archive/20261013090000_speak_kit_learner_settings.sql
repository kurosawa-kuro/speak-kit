-- speak-kit 独自の設定。参照元（private-ops skill-trainer）には無い表。
CREATE TABLE IF NOT EXISTS skill_trainer.learner_settings (
  learner_key varchar PRIMARY KEY,
  ai_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO skill_trainer.learner_settings (learner_key)
VALUES ('default')
ON CONFLICT (learner_key) DO NOTHING;
