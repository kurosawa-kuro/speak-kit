-- 英会話学習アプリ Milestone 4 (Contrast Drill)。混同しやすい型のペアを`contrast_group`で
-- グルーピングする（append-only・既存カラムは変更しない）。
-- 正本 = docs/repos/frontend/retool/specs/英会話学習アプリ-適応訓練エンジン設計.md 7.4章。
-- Applied by `skill-trainer skill-trainer-local-schema-apply` as the admin role (DB_FLOW_URL).

ALTER TABLE skill_trainer.skills ADD COLUMN contrast_group VARCHAR(50);

CREATE INDEX IF NOT EXISTS skills_contrast_group_idx ON skill_trainer.skills (contrast_group);

-- idea doc 7.4の例1そのもの（Did you ...? vs Have you ever ...?）。
-- 他の2例（Could I vs Could you / Would you like vs Would you like to）は対応するSkillが
-- 未seedのため、既存seedと一致するこのペアだけを対象にする。
UPDATE skill_trainer.skills
SET contrast_group = 'PAST_VS_EXPERIENCE'
WHERE canonical_pattern IN ('Did you go to Tokyo?', 'Have you ever been to Tokyo?');
