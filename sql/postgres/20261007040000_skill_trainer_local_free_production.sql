-- 英会話学習アプリ Milestone 4 (Free Production)。話題だけ提示し、特定のSkillに紐付かない
-- 複数文の自由作文を練習する。1件のSkillに紐付かないため、training_events.skill_idを
-- nullable化する（append-only・既存行は変更しない。FK制約はNULLを許容するので整合性は保たれる）。
-- 正本 = docs/repos/frontend/retool/specs/英会話学習アプリ-適応訓練エンジン設計.md 7.5章。
-- Applied by `skill-trainer skill-trainer-local-schema-apply` as the admin role (DB_FLOW_URL).

ALTER TABLE skill_trainer.training_events ALTER COLUMN skill_id DROP NOT NULL;
