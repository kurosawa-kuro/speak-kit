-- 英会話学習アプリ Milestone 4 (Slot Replacement)。既知の型の変数部分を差し替える練習のため、
-- 同じ型を共有するSkillを`template_group`でグルーピングする（append-only・既存カラムは変更しない）。
-- 正本 = docs/repos/frontend/retool/specs/英会話学習アプリ-適応訓練エンジン設計.md 7.3章。
-- Applied by `skill-trainer skill-trainer-local-schema-apply` as the admin role (DB_FLOW_URL).

ALTER TABLE skill_trainer.skills ADD COLUMN template_group VARCHAR(50);

CREATE INDEX IF NOT EXISTS skills_template_group_idx ON skill_trainer.skills (template_group);

-- idea doc 7.3の例文そのもの（Could you help me? / Could you check this? / Could you explain that?）
-- を同一templateとしてタグ付けする。他のSkillはtemplate_group=NULLのまま
-- （1 group内に2件以上揃っているのがこの組だけのため、Slot Replacementの対象はこの組に限定する）。
UPDATE skill_trainer.skills
SET template_group = 'COULD_YOU_REQUEST'
WHERE canonical_pattern IN ('Could you help me?', 'Could you check this?', 'Could you explain that?');
