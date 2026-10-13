-- 英会話学習アプリ Milestone 2: Weakness Engineが skill_id x type でupsertできるよう
-- 一意制約を追加する（append-only・既存カラムは変更しない）。
-- 正本 = docs/tasks/03_active/英会話学習アプリ-ルールベースの弱点推定エンジンを実装する.md。
-- Applied by `skill-trainer skill-trainer-local-schema-apply` as the admin role (DB_FLOW_URL).

ALTER TABLE skill_trainer.weaknesses
  ADD CONSTRAINT weaknesses_skill_type_unique UNIQUE (skill_id, type);
