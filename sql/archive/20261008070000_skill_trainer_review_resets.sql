-- 再チェック。成功の記録は消さず、この時刻より前の正解では出題を止めない。

CREATE TABLE IF NOT EXISTS skill_trainer.review_resets (
    reset_id      UUID PRIMARY KEY,
    learner_key   VARCHAR(80) NOT NULL DEFAULT 'default',
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS review_resets_learner_idx
  ON skill_trainer.review_resets (learner_key, requested_at DESC);

ALTER TABLE skill_trainer.review_resets OWNER TO job_control_api;
