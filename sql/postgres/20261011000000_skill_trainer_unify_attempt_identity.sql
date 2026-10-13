-- skill_trainer DB再設計のAttempt identity統合。
-- quiz(選択式)とconfusion probe(混同対の書いて答える確認)の回答事実が、training_attemptsと
-- 独立した3系統の識別子を持っていたのを、training_attempts.attempt_idという単一のAttempt
-- identityへ合流させる。各response_modeのスケジューリング/採点ロジック(quiz_attempts・
-- confusion_eventsの既存SQL)自体は変えない。「同じ事実を複数の無関係なtableが持つ」のを
-- 「1つの共有timeline + modeごとの詳細table」へ変える。

-- training_attemptsはこれまで必ずExerciseDefinitionを介した自由記述回答だけを想定し
-- exercise_instance_idをNOT NULLにしていた。choice/confusion_probeはExerciseDefinitionを
-- 経由しないため、response_modeで型を分け、free_textの時だけexercise_instance_idを要求する。
ALTER TABLE skill_trainer.training_attempts
  ALTER COLUMN exercise_instance_id DROP NOT NULL;

ALTER TABLE skill_trainer.training_attempts
  ADD COLUMN IF NOT EXISTS response_mode VARCHAR(20) NOT NULL DEFAULT 'free_text';

ALTER TABLE skill_trainer.training_attempts
  ADD CONSTRAINT training_attempts_response_mode_check
  CHECK (response_mode IN ('free_text', 'choice', 'confusion_probe'));

ALTER TABLE skill_trainer.training_attempts
  ADD CONSTRAINT training_attempts_mode_shape_check
  CHECK (
    (response_mode = 'free_text' AND exercise_instance_id IS NOT NULL)
    OR (response_mode <> 'free_text' AND exercise_instance_id IS NULL)
  );

-- quiz_attempts: 既存71件を1件ずつ、対応するtraining_attempts行(response_mode='choice')へ
-- 逆引きできるようにbackfillする。append-only triggerは一時的に外し、backfill後に戻す。
ALTER TABLE skill_trainer.quiz_attempts
  ADD COLUMN IF NOT EXISTS training_attempt_id UUID
    REFERENCES skill_trainer.training_attempts(attempt_id);

DROP TRIGGER IF EXISTS quiz_attempts_append_only ON skill_trainer.quiz_attempts;

DO $$
DECLARE
  r RECORD;
  new_id UUID;
BEGIN
  FOR r IN
    SELECT attempt_id, selected_option_id, latency_ms, answered_at
    FROM skill_trainer.quiz_attempts
    WHERE training_attempt_id IS NULL
  LOOP
    new_id := gen_random_uuid();
    INSERT INTO skill_trainer.training_attempts
      (attempt_id, exercise_instance_id, actual, input_modality, response_mode,
       latency_ms, occurred_at, created_at)
    VALUES
      (new_id, NULL, r.selected_option_id, 'text', 'choice',
       r.latency_ms, r.answered_at, now());
    UPDATE skill_trainer.quiz_attempts
    SET training_attempt_id = new_id
    WHERE attempt_id = r.attempt_id;
  END LOOP;
END $$;

CREATE TRIGGER quiz_attempts_append_only
  BEFORE UPDATE OR DELETE ON skill_trainer.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

ALTER TABLE skill_trainer.quiz_attempts
  ALTER COLUMN training_attempt_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS quiz_attempts_training_attempt_idx
  ON skill_trainer.quiz_attempts (training_attempt_id);

-- confusion_events: 'mistake'種別は元からtraining_attempts.attempt_idを指していたが
-- FK未宣言だった。'probe_success'/'probe_failure'種別(書いて答える確認)はsubmission_idだけの
-- 孤立したeventだった。現在0行(未使用機能)なのでbackfillは不要。CHECKをattempt_id必須へ
-- 強め、FKを宣言し、submission_idはidempotencyキーとしてprobe系だけに残す。
ALTER TABLE skill_trainer.confusion_events
  DROP CONSTRAINT confusion_events_check;

ALTER TABLE skill_trainer.confusion_events
  ADD CONSTRAINT confusion_events_check
  CHECK (
    attempt_id IS NOT NULL
    AND (
      (kind = 'mistake' AND submission_id IS NULL)
      OR (kind IN ('probe_success', 'probe_failure') AND submission_id IS NOT NULL)
    )
  );

ALTER TABLE skill_trainer.confusion_events
  ADD CONSTRAINT confusion_events_attempt_id_fkey
  FOREIGN KEY (attempt_id) REFERENCES skill_trainer.training_attempts(attempt_id);

-- Assessment Contract(R1)の対になる不変条件: quiz/confusion probeの回答は
-- deterministicな自己採点であり、AI grading(grading_observations)を一度も経由しない。
-- この隔離を「今はそういうコードパスだから」という偶然ではなく、DB側の不変条件として
-- 固定する。将来のコード変更でquiz/confusion系のtraining_attempt_idがgrading_observations
-- へ紛れ込んでもINSERT自体を拒否する。
CREATE OR REPLACE FUNCTION skill_trainer.reject_grading_for_non_free_text_attempt()
RETURNS trigger AS $$
BEGIN
  IF NEW.training_attempt_id IS NOT NULL THEN
    IF (
      SELECT response_mode FROM skill_trainer.training_attempts
      WHERE attempt_id = NEW.training_attempt_id
    ) <> 'free_text' THEN
      RAISE EXCEPTION
        'grading_observations.training_attempt_id % refers to a non free_text training_attempts row; quiz/confusion-probe responses must never produce a GradingObservation or CapabilityEvidence',
        NEW.training_attempt_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER grading_observations_require_free_text_attempt
  BEFORE INSERT ON skill_trainer.grading_observations
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_grading_for_non_free_text_attempt();
