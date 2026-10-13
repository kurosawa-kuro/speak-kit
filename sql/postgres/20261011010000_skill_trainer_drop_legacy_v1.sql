-- skill_trainer DB再設計のlegacy v1削除。
-- v1(2026-10-07 baseline)の5テーブルを削除する。R3でdispatch/frontend呼び出しが0件である
-- ことを確認済み、R4直前の棚卸しでも次を確認済み(いずれも実測・コードgrepで確定。
-- db-control-plane-tokens-not-dead-by-code-grep の教訓を踏まえ、migration SQL自体も
-- grepしてランタイム外の一度きりDMLしか参照していないことを確認した):
--   - skill_concepts(v2)はskills(v1)から一度もsyncされていない独立したcatalogであり、
--     v1→v2移行時(migration 12/14)の一度きりのDMLだけがskillsを参照していた
--   - skill_trainer_local::sync_core_seed_from_env (CLI `skill-trainer-local-core-seed-sync`)
--     がskillsへの唯一の生きた書き込み経路だったが、上記の理由でv2へ何も伝播しない
--     死んだ経路だったため同じ変更セットでCLIごと削除した
--   - skill_states/training_events/weaknesses/legacy_skill_migration_decisionsは
--     Rustコードからのランタイム参照が0件(grep確認)で、FK依存もこの5テーブル内で
--     閉じている(他オブジェクトからの外部参照なし)
-- 14.1 EngineReleaseGateの再構築性・冪等性・plan実行等はv2側(training_attempts→
-- grading_observations→effective_capability_evidence→weakness_diagnoses→
-- training_plan_items)で既にlive運用中であり、本migrationはそれに依存しない
-- v1専用クラスタの削除に限定する。

DROP TABLE IF EXISTS skill_trainer.legacy_skill_migration_decisions;
DROP TABLE IF EXISTS skill_trainer.skill_states;
DROP TABLE IF EXISTS skill_trainer.weaknesses;
DROP TABLE IF EXISTS skill_trainer.training_events;
DROP TABLE IF EXISTS skill_trainer.skills;
