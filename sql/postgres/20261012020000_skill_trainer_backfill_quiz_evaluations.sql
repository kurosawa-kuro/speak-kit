-- migration 22 unified quiz identity before Evaluation became a first-class
-- chain member. Complete the historical Exercise -> Attempt -> Response ->
-- Evaluation chain without making quiz results eligible for Evidence.
INSERT INTO skill_trainer.grading_observations
  (grading_id, training_attempt_id, source, observer_version, idempotency_key,
   status, adopted_for_evidence, rubric_version, dimension_results, reason, created_at)
SELECT gen_random_uuid(), qa.training_attempt_id, 'deterministic',
       'quiz-choice-backfill-v1',
       md5('quiz-choice-backfill:' || qa.training_attempt_id::text) ||
       md5(qa.training_attempt_id::text || ':quiz-choice-backfill'),
       'graded', FALSE, 'quiz-choice:1',
       jsonb_build_object(
         'deterministic_outcome',
         CASE WHEN qa.outcome = 'success' THEN 'pass' ELSE 'fail' END
       ),
       'historical quiz Evaluation backfill', qa.answered_at
FROM skill_trainer.quiz_attempts qa
WHERE NOT EXISTS (
  SELECT 1
  FROM skill_trainer.grading_observations observation
  WHERE observation.training_attempt_id = qa.training_attempt_id
);
