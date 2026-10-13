-- 英会話学習アプリ Milestone 5 (Phase 1 Talk)。Teacher/Learner/Free Talkの3シナリオで
-- 複数ターンの会話を記録する。training_events（1イベント=1ターン）とは別モデルが必要
-- （1セッション=複数ターンの構造・セッション単位の集計カウンタを持つため）。
-- 正本 = docs/repos/frontend/retool/specs/英会話学習アプリ-適応訓練エンジン設計.md 7.6章・11.3章。
-- Applied by `skill-trainer skill-trainer-local-schema-apply` as the admin role (DB_FLOW_URL).

CREATE TABLE IF NOT EXISTS skill_trainer.conversation_sessions (
    id                       BIGSERIAL PRIMARY KEY,
    scenario                 VARCHAR(20) NOT NULL CHECK (scenario IN ('teacher', 'learner', 'free_talk')),
    session_id               UUID NOT NULL,
    started_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at                 TIMESTAMPTZ,
    turn_count               INTEGER NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
    self_question_count      INTEGER NOT NULL DEFAULT 0 CHECK (self_question_count >= 0),
    follow_up_count          INTEGER NOT NULL DEFAULT 0 CHECK (follow_up_count >= 0),
    error_handling_count     INTEGER NOT NULL DEFAULT 0 CHECK (error_handling_count >= 0),
    freeze_count             INTEGER NOT NULL DEFAULT 0 CHECK (freeze_count >= 0),
    japanese_fallback_count  INTEGER NOT NULL DEFAULT 0 CHECK (japanese_fallback_count >= 0),
    avg_latency_ms           INTEGER CHECK (avg_latency_ms IS NULL OR avg_latency_ms >= 0)
);

CREATE INDEX IF NOT EXISTS conversation_sessions_started_idx ON skill_trainer.conversation_sessions (started_at);

-- idea doc 7.6 評価対象（自発質問数・Follow-up数・ERROR HANDLING使用・完全停止・日本語fallback）を
-- ターン単位のフラグとして残す（セッション集計だけでなく、後から採点ロジックを見直せるように
-- イベントを残すのがMilestone 1以来の方針）。
CREATE TABLE IF NOT EXISTS skill_trainer.conversation_turns (
    id                        BIGSERIAL PRIMARY KEY,
    conversation_session_id   BIGINT NOT NULL REFERENCES skill_trainer.conversation_sessions(id),
    turn_index                INTEGER NOT NULL CHECK (turn_index >= 0),
    role                       VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
    content                    TEXT NOT NULL,
    latency_ms                 INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
    self_question               BOOLEAN NOT NULL DEFAULT FALSE,
    follow_up                   BOOLEAN NOT NULL DEFAULT FALSE,
    error_handling               BOOLEAN NOT NULL DEFAULT FALSE,
    is_freeze                    BOOLEAN NOT NULL DEFAULT FALSE,
    japanese_fallback             BOOLEAN NOT NULL DEFAULT FALSE,
    occurred_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS conversation_turns_session_idx ON skill_trainer.conversation_turns (conversation_session_id);

ALTER TABLE skill_trainer.conversation_sessions OWNER TO job_control_api;
ALTER TABLE skill_trainer.conversation_turns OWNER TO job_control_api;
