# テストが本物の学習記録に書き込まないようにする

## Weight Class

- Class: Medium
- Reason: テストの接続先を、使い捨ての DB に分ける。テストの準備（schema と教材の投入）を作る。既に入った偽の行を片付ける。
- Limits: live DB、Supabase、secret のコミットは 0。本物の `speak_kit` への書き込みは、片付けの DELETE だけにする。owner の承認後に行う。
- Owner approval required: yes。`03_active/` へ移す指示があるまで着手しない。

## Goal

`npm test` を何回流しても、本物の `speak_kit` の行が 1 行も増えず、設定も変わらない状態にする。

## Context

- 出どころ: `05_done/実運用可能な状況かをレビュー依頼.md` の R2。
- `src/test/golden-path.test.mjs` と `src/test/settings.test.mjs` は、`src/lib/db.mjs` の `pool` を通して、本物の `speak_kit` に `dispatch` を呼んでいる。
- 1 回の `npm test` で書き込まれるもの:
  - クイズの回答（回答時間 12 ミリ秒）
  - 記述の回答（回答時間 1500・2000 ミリ秒）
  - 会話の開始・送信・終了
  - 混同ペアの登録（lend / borrow）
  - 今日の計画と練習問題の作成
- `settings.test.mjs` は、本物の `learner_settings.ai_enabled` をオフにしてから元に戻す。テストの間（約 1 秒）は、動いているアプリでも AI がオフになる。途中で止まると、オフのまま残る。
- 2026-10-13 19:00 時点の偽の行: クイズの回答 16 件（`quiz_attempts.latency_ms = 12`）、記述の回答 20 件（`training_attempts.latency_ms` が 1500 か 2000）。どちらも正答率・反応時間・弱点の診断・今日の計画に混ざっている。
- `src/lib/db.mjs` は、DB 名が `speak_kit` 以外だと接続を拒否する。テスト用の DB へは、今のままではつながらない。
- 教材は `data/` の YAML から `npm run data:sync -- --apply` で入れられる。schema は `sql/postgres/` の 29 本だが、適用の記録が無く、流し直すと 22 本目で失敗する（`2026-10-13-architecture-refactor-db-first.md` の D-8）。

## Scope

1. テスト用の DB `speak_kit_test` を使う。
   - `src/lib/db.mjs` の検査を、`speak_kit` と `speak_kit_test` だけを許す形にする。`flow` と、それ以外の名前は今までどおり拒否する。
   - テストは `SPEAK_KIT_DATABASE_URL=postgresql://kurosawa@localhost:5432/speak_kit_test` で動かす。
   - `package.json` の `test` スクリプトでこの値を渡す。
2. テストの準備を作る（`src/test/setup-db.mjs` か `scripts/reset-test-db.sh`）。
   - `speak_kit_test` を作り直す（DROP → CREATE）。
   - 前提の role と表を作る（`job_control_api`、`public.flow_schema_migrations`）。
   - `sql/postgres/*.sql` を順に流す。
   - `data:sync -- --apply` で教材を入れる。
   - 空の DB から毎回作るので、22 本目の再適用の失敗には当たらない。
3. 本物の DB に書いていないことを、テスト自身が確かめる。
   - テストの開始時に `current_database()` が `speak_kit_test` であることを assert する。違えば、何も書かずに失敗する。
4. 既に入った偽の行を片付ける（owner 承認後）。
   - 対象は、テストが書いたと判別できる行だけにする。
     - `quiz_attempts.latency_ms = 12` と、それに紐づく `training_attempts`・`grading_observations`・`capability_evidence`
     - 回答時間 1500・2000 ミリ秒の記述の回答
     - テストの会話
   - 追記専用のトリガーがあるため、片付けの SQL ではトリガーを一時的に外す。
   - 実行前に `pg_dump -Fc speak_kit` を取る。
   - 片付けずに、DB の作り直し（リファクタリング案の第 2 段）でまとめて捨てる選択肢もある。

## Non-scope

- DB の作り直し、migration の適用記録の仕組み（リファクタリング案の第 2 段）
- バックアップの定期実行（別時期で検討）
- テストの中身（何を確かめるか）を変えること

## Plan

1. 着手前に、本物の `speak_kit` の主な表の件数を記録する（`training_attempts`、`quiz_attempts`、`conversation_sessions`、`confusion_pairs`、`learner_settings`）。
2. Scope 1〜3 を実装する。
3. `npm test` を 2 回流す。
4. 本物の `speak_kit` の件数が、手順 1 から 1 行も変わっていないことを確かめる。`learner_settings.updated_at` も変わっていないこと。
5. owner の判断に従って、Scope 4 を行うか、第 2 段に回す。

## Acceptance Criteria

- `npm test` が全件通る。
- `npm test` の前後で、本物の `speak_kit` の全表の件数と `learner_settings.updated_at` が同じである。
- `SPEAK_KIT_DATABASE_URL` を付けずにテストを直接実行すると、書き込む前に失敗する（Scope 3）。
- `db.mjs` は `flow` と、`speak_kit` / `speak_kit_test` 以外の DB 名を拒否する。

## Owner-only Decisions

- `03_active/` へ移す承認
- 既に入った偽の行（クイズ 16 件、記述 20 件、テストの会話）を今消すか、DB の作り直しでまとめて捨てるか

## Evidence Required

- `npm test` の前後の、本物の `speak_kit` の件数の表
- `npm test` の出力
- Scope 3 の失敗の出力

## Result（2026-10-13）

- `src/lib/db.mjs`: 接続してよい DB を `speak_kit` と `speak_kit_test` だけにした。`flow` と、ほかの名前は拒否する。
- `scripts/reset-test-db.sh`（新規）: `speak_kit_test` を DROP → CREATE し、前提の role `job_control_api`（無ければ作る）と表 `public.flow_schema_migrations` を作る。`sql/postgres/*.sql` 29 本を順に流し、`data/` の教材を入れる。
- `src/cli/data.mjs` / `src/lib/content/sync.mjs`: `data:sync` に `--catalog-only` を足した。空の DB に入れるとき、画面から登録された混同ペア（YAML の `source: learner_registered` の 2 件）は YAML からは足せず止まるので、飛ばす。付けないときの動きは今までどおり。
- `src/test/test-db.mjs`（新規）: 最初に `current_database()` を調べ、`speak_kit_test` でなければ何も書かずに失敗する。DB に書く `golden-path.test.mjs` と `settings.test.mjs` は、これを最初に import する。
- `package.json` の `test`: `sh scripts/reset-test-db.sh && SPEAK_KIT_DATABASE_URL=postgresql://kurosawa@localhost:5432/speak_kit_test node --test src/test/*.test.mjs`
- 文書: `README.md`（テスト節）、`docs/07_test_strategy.md`（テストの DB）、`data/README.md`（`--catalog-only`）。
- Scope 4（既に入った偽の行の片付け）は行わない。DB の作り直し（リファクタリング案の第 2 段）でまとめて捨てる。

## Evidence

`npm test` を 2 回流した。

```text
=== run 1
reset speak_kit_test: 29 schema files + data/ applied
# tests 25
# pass 25
# fail 0
=== run 2
reset speak_kit_test: 29 schema files + data/ applied
# tests 25
# pass 25
# fail 0
```

本物の `speak_kit` は、作業前に全 30 表の件数と `learner_settings` を記録し、2 回の `npm test` の後に比べた。差分は 0 だった。

| 表 | 前 | 後 |
|---|---|---|
| `training_attempts` | 70 | 70 |
| `quiz_attempts` | 34 | 34 |
| `conversation_sessions` | 16 | 16 |
| `confusion_pairs` | 34 | 34 |
| `learner_settings` | `default / ai_enabled true / 2026-10-13 18:55:32.810277+09` | 同じ |

テストの回答は `speak_kit_test` に入った（`quiz_attempts` 3 件）。

Scope 3（接続先を付けずに直接実行）:

```text
$ node --test src/test/golden-path.test.mjs src/test/settings.test.mjs
# Error: テストは speak_kit_test でだけ動かす（今の接続先: speak_kit）。npm test で実行すること
# Error: テストは speak_kit_test でだけ動かす（今の接続先: speak_kit）。npm test で実行すること
# pass 0
# fail 2
```

この後も本物の `speak_kit` の件数は変わっていない。

`db.mjs` の接続先の検査:

```text
flow           → rejected: speak-kit refuses database flow
other          → rejected: speak-kit database must be speak_kit or speak_kit_test, got other
speak_kit_test → accepted
```

## 残ること

- 既に本物の `speak_kit` に入っている偽の行（クイズ・記述の回答、テストの会話、lend / borrow の混同ペア）は残っている。DB の作り直しで捨てる。
- `npm test` は毎回 `speak_kit_test` を消して作り直す。実行中に別の `npm test` を重ねて流さないこと。
