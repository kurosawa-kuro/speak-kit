-- 英会話学習アプリ Phase 1（P9）Milestone 0: Domain Model。既存 job_control_local と同じ
-- flow Postgres インスタンス・同じ control role (job_control_api) への増設。新規 Postgres
-- インスタンス・新規 API サーバは建てない。
-- 正本 = docs/repos/frontend/retool/specs/英会話学習アプリ-適応訓練エンジン設計.md、
--       docs/tasks/03_active/英会話学習アプリ-ドメインモデルと基礎訓練MVPまでのPhase1を実装する.md、
--       frontend/retool/管理｜英会話学習.md。
-- Applied by `skill-trainer skill-trainer-local-schema-apply` as the admin role (DB_FLOW_URL).

CREATE SCHEMA IF NOT EXISTS skill_trainer AUTHORIZATION job_control_api;

CREATE TABLE IF NOT EXISTS skill_trainer.skills (
    id                  BIGSERIAL PRIMARY KEY,
    canonical_pattern   VARCHAR(255) NOT NULL,
    meaning             TEXT NOT NULL,
    category            VARCHAR(20) NOT NULL
      CHECK (category IN ('OUTPUT', 'QUERY', 'TIME', 'ACTION', 'ERROR_HANDLING')),
    intent              VARCHAR(50),
    phase               SMALLINT NOT NULL DEFAULT 1 CHECK (phase IN (1, 2, 3)),
    tier                VARCHAR(20) NOT NULL DEFAULT 'CORE' CHECK (tier IN ('CORE', 'TIER1')),
    direction           VARCHAR(10) NOT NULL DEFAULT 'OUTPUT' CHECK (direction IN ('OUTPUT', 'INPUT')),
    output_policy       VARCHAR(30)
      CHECK (output_policy IS NULL OR output_policy IN ('POLITE_NEUTRAL')),
    status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (length(canonical_pattern) > 0),
    CHECK (length(meaning) > 0),
    UNIQUE (canonical_pattern)
);

CREATE INDEX IF NOT EXISTS skills_category_idx ON skill_trainer.skills (category);
CREATE INDEX IF NOT EXISTS skills_phase_tier_idx ON skill_trainer.skills (phase, tier);

-- 1 Skill : 1 SkillState。idea doc 5.2「単一スコアだけで終わらせない」= 次元ごとに列を分離する。
CREATE TABLE IF NOT EXISTS skill_trainer.skill_states (
    skill_id                BIGINT PRIMARY KEY REFERENCES skill_trainer.skills(id),
    understanding           SMALLINT CHECK (understanding IS NULL OR understanding BETWEEN 0 AND 100),
    intent_understanding    SMALLINT CHECK (intent_understanding IS NULL OR intent_understanding BETWEEN 0 AND 100),
    recognition             SMALLINT CHECK (recognition IS NULL OR recognition BETWEEN 0 AND 100),
    controlled_recall        SMALLINT CHECK (controlled_recall IS NULL OR controlled_recall BETWEEN 0 AND 100),
    slot_replacement         SMALLINT CHECK (slot_replacement IS NULL OR slot_replacement BETWEEN 0 AND 100),
    contrast_selection       SMALLINT CHECK (contrast_selection IS NULL OR contrast_selection BETWEEN 0 AND 100),
    free_recall              SMALLINT CHECK (free_recall IS NULL OR free_recall BETWEEN 0 AND 100),
    conversation_usage       SMALLINT CHECK (conversation_usage IS NULL OR conversation_usage BETWEEN 0 AND 100),
    avg_latency_ms           INTEGER CHECK (avg_latency_ms IS NULL OR avg_latency_ms >= 0),
    p50_latency_ms           INTEGER CHECK (p50_latency_ms IS NULL OR p50_latency_ms >= 0),
    recent_error_rate        SMALLINT CHECK (recent_error_rate IS NULL OR recent_error_rate BETWEEN 0 AND 100),
    retention_1d             SMALLINT CHECK (retention_1d IS NULL OR retention_1d BETWEEN 0 AND 100),
    retention_7d             SMALLINT CHECK (retention_7d IS NULL OR retention_7d BETWEEN 0 AND 100),
    retention_30d            SMALLINT CHECK (retention_30d IS NULL OR retention_30d BETWEEN 0 AND 100),
    last_seen_at             TIMESTAMPTZ,
    last_success_at          TIMESTAMPTZ,
    last_failure_at          TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- idea doc 5.3: 「弱い」だけでなく原因タイプを持つ。Weakness Engine (Milestone 2) がここへ書く。
-- Milestone 1 はこのテーブルへ書き込まない（テーブル自体は Domain Model として先に固定する）。
CREATE TABLE IF NOT EXISTS skill_trainer.weaknesses (
    id                  BIGSERIAL PRIMARY KEY,
    skill_id            BIGINT NOT NULL REFERENCES skill_trainer.skills(id),
    type                VARCHAR(30) NOT NULL
      CHECK (type IN (
        'MEANING', 'INTENT', 'LISTENING_RECOGNITION', 'FORM_SELECTION', 'TENSE_SELECTION',
        'WORD_ORDER', 'CONTROLLED_RETRIEVAL', 'FREE_RETRIEVAL', 'LATENCY', 'SLOT_REPLACEMENT',
        'CONTRAST_CONFUSION', 'CONVERSATION_USAGE', 'RETENTION'
      )),
    severity            SMALLINT CHECK (severity IS NULL OR severity BETWEEN 0 AND 100),
    confidence          SMALLINT CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_observed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS weaknesses_skill_idx ON skill_trainer.weaknesses (skill_id);

-- idea doc 5.4: 練習の生ログ。集計値だけ保存せず、採点ロジック・弱点判定を後から改善できるよう
-- イベントを残す。Milestone 1 (Controlled Recall MVP) が書き込む最初のテーブル。
CREATE TABLE IF NOT EXISTS skill_trainer.training_events (
    id                  BIGSERIAL PRIMARY KEY,
    skill_id            BIGINT NOT NULL REFERENCES skill_trainer.skills(id),
    training_mode       VARCHAR(30) NOT NULL
      CHECK (training_mode IN (
        'recognition', 'controlled_recall', 'slot_replacement', 'contrast_drill',
        'free_production', 'conversation_drill'
      )),
    prompt              TEXT,
    expected            TEXT,
    actual              TEXT,
    correct             BOOLEAN NOT NULL,
    latency_ms          INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
    error_types         TEXT[] NOT NULL DEFAULT '{}',
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id          UUID
);

CREATE INDEX IF NOT EXISTS training_events_skill_idx ON skill_trainer.training_events (skill_id);
CREATE INDEX IF NOT EXISTS training_events_occurred_idx ON skill_trainer.training_events (occurred_at);

-- idea doc 5.5: 実戦で必要になったが未採用の部品。Milestone 6 (Review) が書き込む。
CREATE TABLE IF NOT EXISTS skill_trainer.candidate_skills (
    id                  BIGSERIAL PRIMARY KEY,
    pattern             VARCHAR(255) NOT NULL,
    meaning             TEXT,
    source_context      TEXT,
    need_count          INTEGER NOT NULL DEFAULT 0 CHECK (need_count >= 0),
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status              VARCHAR(20) NOT NULL DEFAULT 'candidate'
      CHECK (status IN ('candidate', 'promoted', 'rejected')),
    CHECK (length(pattern) > 0)
);

CREATE INDEX IF NOT EXISTS candidate_skills_status_idx ON skill_trainer.candidate_skills (status);

-- idea doc 5.6: 黒澤専用ポリシー。単一行のみ(id=1固定)。AI採点・出題生成が従う既定値。
CREATE TABLE IF NOT EXISTS skill_trainer.learning_policy (
    id                                      SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    output_style                            VARCHAR(30) NOT NULL DEFAULT 'POLITE_NEUTRAL',
    casual_output                           VARCHAR(30) NOT NULL DEFAULT 'DISABLED',
    casual_input                            VARCHAR(30) NOT NULL DEFAULT 'RECOGNITION_ONLY',
    articles_priority                       VARCHAR(10) NOT NULL DEFAULT 'LOW',
    native_like_expression_priority         VARCHAR(10) NOT NULL DEFAULT 'LOW',
    pronunciation_perfection_priority       VARCHAR(10) NOT NULL DEFAULT 'LOW',
    short_sentence_priority                 VARCHAR(10) NOT NULL DEFAULT 'HIGH',
    reusable_pattern_priority               VARCHAR(10) NOT NULL DEFAULT 'HIGH',
    communication_continuity_priority       VARCHAR(10) NOT NULL DEFAULT 'HIGHEST',
    new_skill_policy                        VARCHAR(30) NOT NULL DEFAULT 'REPEATED_NEED',
    updated_at                              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE skill_trainer.skills OWNER TO job_control_api;
ALTER TABLE skill_trainer.skill_states OWNER TO job_control_api;
ALTER TABLE skill_trainer.weaknesses OWNER TO job_control_api;
ALTER TABLE skill_trainer.training_events OWNER TO job_control_api;
ALTER TABLE skill_trainer.candidate_skills OWNER TO job_control_api;
ALTER TABLE skill_trainer.learning_policy OWNER TO job_control_api;
