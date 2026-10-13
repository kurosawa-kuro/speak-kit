-- 英会話学習アプリ: migration 10のpartial unique index (WHERE external_id IS NOT NULL)は
-- `INSERT ... ON CONFLICT (external_id)`のarbiterとして一致しない
-- （"there is no unique or exclusion constraint matching the ON CONFLICT specification"）。
-- PostgresのUNIQUE制約はNULLを複数許容する（NULL同士は衝突しない）ため、
-- external_idが常に非NULLで渡される本アプリの使い方ではpartial indexにする必要が
-- そもそも無かった。plainなUNIQUE indexへ置き換える（実機でsync_core_seed_from_envを
-- 初回実行した際に検出・同日中に修正）。
-- Applied by `skill-trainer skill-trainer-local-schema-apply` as the admin role (DB_FLOW_URL).

DROP INDEX IF EXISTS skill_trainer.skills_external_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS skills_external_id_unique ON skill_trainer.skills (external_id);
