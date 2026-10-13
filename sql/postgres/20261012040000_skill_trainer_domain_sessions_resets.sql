-- Talk セッションと復習リセットを domain ごとに分ける。
-- training_attempts は exercises → assessment_contracts.domain_id で domain へ辿れるので列を足さない。
-- conversation_sessions と review_resets は出題を経由しないため、自分で domain_id を持つ。
-- grading_observations は Attempt か Turn（→ session）経由で辿る。
DO $$
DECLARE
    english_id BIGINT;
BEGIN
    SELECT id INTO STRICT english_id
    FROM skill_trainer.domains
    WHERE code = 'english_conversation';

    EXECUTE format(
        'ALTER TABLE skill_trainer.conversation_sessions ADD COLUMN domain_id BIGINT NOT NULL DEFAULT %s REFERENCES skill_trainer.domains(id)',
        english_id
    );
    EXECUTE format(
        'ALTER TABLE skill_trainer.review_resets ADD COLUMN domain_id BIGINT NOT NULL DEFAULT %s REFERENCES skill_trainer.domains(id)',
        english_id
    );
END $$;

ALTER TABLE skill_trainer.conversation_sessions ALTER COLUMN domain_id DROP DEFAULT;
ALTER TABLE skill_trainer.review_resets ALTER COLUMN domain_id DROP DEFAULT;

CREATE INDEX conversation_sessions_domain_idx
    ON skill_trainer.conversation_sessions (domain_id, started_at);
CREATE INDEX review_resets_domain_idx
    ON skill_trainer.review_resets (domain_id, learner_key, requested_at);
