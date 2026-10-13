-- Regrading appends observations but may adopt at most one interpretation as
-- learner Evidence for a training attempt. Concurrent retries therefore cannot
-- double-count the same immutable answer.

CREATE UNIQUE INDEX IF NOT EXISTS grading_observations_one_adopted_attempt_idx
  ON skill_trainer.grading_observations (training_attempt_id)
  WHERE training_attempt_id IS NOT NULL AND adopted_for_evidence = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS capability_evidence_one_attempt_capability_idx
  ON skill_trainer.capability_evidence (training_attempt_id, skill_id, capability)
  WHERE training_attempt_id IS NOT NULL;

ALTER INDEX skill_trainer.grading_observations_one_adopted_attempt_idx OWNER TO job_control_api;
ALTER INDEX skill_trainer.capability_evidence_one_attempt_capability_idx OWNER TO job_control_api;
