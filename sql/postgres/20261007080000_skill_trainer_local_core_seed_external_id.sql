-- 英会話学習アプリ: Core seedデータの格納方法リファクタリング（owner指摘2026-10-07
-- 「ここから変えないと、冪等性問題で破綻する」）。
--
-- 問題: migration 8はJSON(phase1_english_japanese_seed.json)の内容を手でSQLへ書き写した
-- 1回限りのINSERT(ON CONFLICT DO NOTHING)だった。JSONの内容を後から直す度に(migration 9が
-- まさにそれ)、人力でUPDATE migrationを増産する必要があり、JSON側の修正がDBへ機械的に
-- 反映されない=JSONとDBが別々の正本に分岐する。
--
-- 対策: canonical_pattern(内容そのもので編集される可能性がある)ではなく、JSON側が元々持つ
-- 安定id("P1-001"等)をexternal_idとして持たせ、これを照合キーにする。これにより
-- `sync_core_seed_from_env`（ledger外・何度でも再実行可能な専用コマンド）がJSON
-- （sql/postgres/seed-data/skill_trainer_core_seed_50.json。正本はここへ移設・修正済み。
-- 旧docs/tasks/02_backlog/phase1_english_japanese_seed.jsonは削除）を読み、
-- `INSERT ... ON CONFLICT (external_id) DO UPDATE`で常に収束させられるようになる。
-- 以後、JSONの内容修正は新規migrationを書かずにこのコマンドの再実行だけで反映される。
--
-- 本migrationはこの照合キーを追加し、既存の50件（6件はmigration 2の元seedと
-- canonical_pattern重複でmigration 8時にINSERTされず、元のmigration 2行がそのまま生きている）
-- へ、現在生きているcanonical_patternから逆引きしてexternal_idを1回だけbackfillする。
-- Applied by `skill-trainer skill-trainer-local-schema-apply` as the admin role (DB_FLOW_URL).

ALTER TABLE skill_trainer.skills ADD COLUMN IF NOT EXISTS external_id VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS skills_external_id_unique
  ON skill_trainer.skills (external_id) WHERE external_id IS NOT NULL;

UPDATE skill_trainer.skills SET external_id = 'P1-001' WHERE canonical_pattern = 'I''m a software engineer.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-002' WHERE canonical_pattern = 'I like watching movies.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-003' WHERE canonical_pattern = 'I want to improve my English.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-004' WHERE canonical_pattern = 'I''m tired because I worked all night.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-005' WHERE canonical_pattern = 'It took me a long time to finish this project.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-006' WHERE canonical_pattern = 'That''s why I started learning English.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-007' WHERE canonical_pattern = 'In my case, I work from home.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-008' WHERE canonical_pattern = 'I had no choice but to cancel the meeting.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-009' WHERE canonical_pattern = 'I used to live in Osaka, but now I live in Tokyo.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-010' WHERE canonical_pattern = 'I don''t mean today. I mean tomorrow.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-011' WHERE canonical_pattern = 'Do you drink coffee?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-012' WHERE canonical_pattern = 'Did you sleep well?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-013' WHERE canonical_pattern = 'Are you free tomorrow?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-014' WHERE canonical_pattern = 'What''s your favorite food?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-015' WHERE canonical_pattern = 'Why were you late?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-016' WHERE canonical_pattern = 'How was your weekend?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-017' WHERE canonical_pattern = 'Have you ever been abroad?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-018' WHERE canonical_pattern = 'How about you?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-019' WHERE canonical_pattern = 'I usually wake up at 7.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-020' WHERE canonical_pattern = 'I watched a movie yesterday.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-021' WHERE canonical_pattern = 'I''m working now.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-022' WHERE canonical_pattern = 'I''m going to travel next month.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-023' WHERE canonical_pattern = 'I''ve been to Kyoto.' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-024' WHERE canonical_pattern = 'Could I ask you something?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-025' WHERE canonical_pattern = 'Could you send me the file?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-026' WHERE canonical_pattern = 'Would you like to grab lunch?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-027' WHERE canonical_pattern = 'How about next Monday?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-028' WHERE canonical_pattern = 'Could you say that again?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-029' WHERE canonical_pattern = 'What does that mean?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-030' WHERE canonical_pattern = 'Do you mean the meeting is canceled?' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-031' WHERE canonical_pattern = 'get home' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-032' WHERE canonical_pattern = 'get tired' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-033' WHERE canonical_pattern = 'get better' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-034' WHERE canonical_pattern = 'get ready' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-035' WHERE canonical_pattern = 'take a shower' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-036' WHERE canonical_pattern = 'take a break' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-037' WHERE canonical_pattern = 'take a bus' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-038' WHERE canonical_pattern = 'take medicine' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-039' WHERE canonical_pattern = 'have breakfast' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-040' WHERE canonical_pattern = 'have time' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-041' WHERE canonical_pattern = 'have fun' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-042' WHERE canonical_pattern = 'have a problem' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-043' WHERE canonical_pattern = 'go home' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-044' WHERE canonical_pattern = 'go shopping' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-045' WHERE canonical_pattern = 'go out' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-046' WHERE canonical_pattern = 'go wrong' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-047' WHERE canonical_pattern = 'feel tired' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-048' WHERE canonical_pattern = 'feel better' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-049' WHERE canonical_pattern = 'feel good' AND external_id IS NULL;
UPDATE skill_trainer.skills SET external_id = 'P1-050' WHERE canonical_pattern = 'feel like pizza' AND external_id IS NULL;
