-- 横断ドメイン。英会話は最初のドメイン `english_conversation`。
-- 資格学習などの2つ目は、同じ適応エンジンの行を domain_id で分ける。
--
-- `skill_trainer.skills` は 2026-10-11 の legacy drop で削除済み。生きている Skill 表は
-- `skill_concepts` なので domain_id はそこへ付ける。training_plans と assessment_contracts
-- も同じキーを持つ。
--
-- FK 棚卸し: skill_trainer migration の REFERENCES はすべて skill_trainer スキーマ内。
-- news スキーマへの外部キーは無い。この migration も news を参照しない。
-- テーブルの物理配置は同じ flow Postgres のまま。移すのは所属 crate と列の追加だけ。

CREATE TABLE skill_trainer.domains (
    id            BIGSERIAL PRIMARY KEY,
    code          VARCHAR(80) NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (length(code) > 0),
    CHECK (length(display_name) > 0)
);

CREATE TABLE skill_trainer.domain_categories (
    domain_id      BIGINT NOT NULL REFERENCES skill_trainer.domains(id),
    category_code  VARCHAR(40) NOT NULL,
    PRIMARY KEY (domain_id, category_code),
    CHECK (length(category_code) > 0)
);

INSERT INTO skill_trainer.domains (code, display_name)
VALUES ('english_conversation', '英会話');

INSERT INTO skill_trainer.domain_categories (domain_id, category_code)
SELECT d.id, category.code
FROM skill_trainer.domains d
CROSS JOIN (
    VALUES ('OUTPUT'), ('QUERY'), ('TIME'), ('ACTION'), ('ERROR_HANDLING')
) AS category(code)
WHERE d.code = 'english_conversation';

-- assessment_contracts は append-only なので UPDATE で埋めない。
-- 定数 DEFAULT の ADD COLUMN は行トリガーを発火せず、既存行へ英会話 domain_id を載せる。
-- DEFAULT は直後に外し、以後の INSERT は domain_id を明示する。
DO $$
DECLARE
    english_id BIGINT;
BEGIN
    SELECT id INTO STRICT english_id
    FROM skill_trainer.domains
    WHERE code = 'english_conversation';

    EXECUTE format(
        'ALTER TABLE skill_trainer.skill_concepts ADD COLUMN domain_id BIGINT NOT NULL DEFAULT %s REFERENCES skill_trainer.domains(id)',
        english_id
    );
    EXECUTE format(
        'ALTER TABLE skill_trainer.training_plans ADD COLUMN domain_id BIGINT NOT NULL DEFAULT %s REFERENCES skill_trainer.domains(id)',
        english_id
    );
    EXECUTE format(
        'ALTER TABLE skill_trainer.assessment_contracts ADD COLUMN domain_id BIGINT NOT NULL DEFAULT %s REFERENCES skill_trainer.domains(id)',
        english_id
    );
END $$;

ALTER TABLE skill_trainer.skill_concepts ALTER COLUMN domain_id DROP DEFAULT;
ALTER TABLE skill_trainer.training_plans ALTER COLUMN domain_id DROP DEFAULT;
ALTER TABLE skill_trainer.assessment_contracts ALTER COLUMN domain_id DROP DEFAULT;

ALTER TABLE skill_trainer.skill_concepts
    DROP CONSTRAINT skill_concepts_category_check;

ALTER TABLE skill_trainer.skill_concepts
    ADD CONSTRAINT skill_concepts_domain_category_fkey
    FOREIGN KEY (domain_id, category)
    REFERENCES skill_trainer.domain_categories (domain_id, category_code);

CREATE INDEX skill_concepts_domain_idx ON skill_trainer.skill_concepts (domain_id, status);
CREATE INDEX training_plans_domain_idx ON skill_trainer.training_plans (domain_id, learner_key, status);

ALTER TABLE skill_trainer.domains OWNER TO job_control_api;
ALTER TABLE skill_trainer.domain_categories OWNER TO job_control_api;
