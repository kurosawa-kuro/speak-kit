# speak-kit のプログラムコードを `src/` 配下にまとめる

## Weight Class

- Class: Light
- Reason: ファイルの置き場所だけを変える。挙動、RPC 名、SQL、DB の行は変えない。
- Limits: `speak_kit` への書き込み、`scripts/apply-local-schema.sh` の再実行、live DB、Vercel、secret のコミットは 0。
- Owner approval required: yes。`03_active/` へ移す指示があるまで着手しない。

## Goal

speak-kit のプログラムコード（アプリとテスト）を `/Users/kurosawa/Dev/speak-kit/src` の下に集める。repo 直下にはコードのディレクトリ（`app/`、`lib/`、`test/`）を残さない。

## Context

2026-10-13 時点の配置:

| 今の場所 | 中身 | 種類 |
|---|---|---|
| `app/` | Next.js App Router（`page.js`、`layout.js`、`shell.js`、`globals.css`、`screens/`、`ui/`、`ai/`、`api/[name]/route.js`、`api/ai/*/route.js`） | アプリコード |
| `lib/` | サーバ側の処理（`dispatch.mjs`、`plan.mjs`、`quiz.mjs`、`attempt.mjs`、`talk.mjs`、`db.mjs`、`ai/*.mjs` ほか 19 ファイル） | アプリコード |
| `test/` | `node --test` のテスト 4 本 | テストコード |
| `sql/postgres/` | 参照元からコピーした migration 28 本 | スキーマ |
| `scripts/apply-local-schema.sh` | ローカル DB への schema 適用 | 運用スクリプト |
| `src/testdata/controlled_recall_grader_fixtures.json` | 参照元の採点 fixture コピー | 参照資料。どのコードからも読まれていない |

speak-kit はフル Next.js であり、Rust は置かない。2026-10-13 に、参照元からコピーしただけで実行も import もされていなかった `src/domains/english_conversation.rs` を削除した。中の会話相手の文は `lib/talk.mjs` と `lib/ai/prompts.mjs` へ移植済みである。

調べて分かったこと:

- Next.js 15 は、repo 直下に `app/` が無ければ `src/app/` を App Router として読む。`next.config.mjs` の変更は要らない。`src/test/` は App Router の外なので、ルートにはならない。
- `app/`、`lib/`、`test/` を一緒に `src/` へ移せば、相互の相対パスは同じ深さのまま解決する。書き換えは要らない。
  - `app/api/[name]/route.js` の `../../../lib/dispatch.mjs`
  - テスト 4 本の `../lib/...` の import
  - `test/ai-isolation.test.mjs` の `new URL(\`../${file}\`, import.meta.url)`。`coreFiles`（`lib/quiz.mjs`、`lib/plan.mjs`、`lib/dispatch.mjs`、`app/api/[name]/route.js`）は `src/` からの相対として、そのまま解決する
  - `test/names.test.mjs` は参照元を絶対パス（`/Users/kurosawa/Dev/private-ops/apps/skill-trainer/src/skill_trainer_local.rs`）で読むので影響しない
- `jsconfig.json` は `baseUrl: "."` だけで、`@/` などの alias は使っていない。
- Tailwind v4（`@tailwindcss/postcss`）はソースを自動検出する。`globals.css` は `app/` と一緒に動く。
- 書き換えが要るのは repo 直下からのパスで参照している箇所だけ:
  - `package.json` の `test` スクリプト（`node --test test/*.test.mjs`）
  - ドキュメント中の `app/`、`lib/`、`test/` の記述（`README.md`、`CLAUDE.md`、`docs/02_architecture.md`、`docs/07_test_strategy.md`、`docs/英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md`、`docs/tasks/05_done/2026-10-13-close-remaining-original-gaps.md`）
- `.claude/rules/tests.md` は `**/*.test.*` でテストを拾うので、移動後も変更は要らない。
- `docs/02_architecture.md` の「参照元」表と `CLAUDE.md`・`README.md` にある `src/domains/`、`src/testdata/`、`src/*.rs` は、参照元 repo（`private-ops/apps/skill-trainer`）の中のパスである。speak-kit の `src/` ではない。移動後に紛らわしくなるので、参照元の repo のパスだと分かる書き方に直す。

## Scope

1. `git mv app src/app`、`git mv lib src/lib`、`git mv test src/test`。履歴を残すため `git mv` を使う。
2. `src/testdata/controlled_recall_grader_fixtures.json` を `src/test/fixtures/` へ `git mv` する。採点のテスト用の fixture として扱い、`src/testdata/` は無くす。
3. `package.json` の `test` を `node --test src/test/*.test.mjs` に直す。
4. `src/test/ai-isolation.test.mjs` の検査文字列 `lib/ai/client` は、`lib` 内の相対 import（`./ai/client.mjs`）を拾えない。`ai/client` で検査するように直す。今は検査が素通りしている状態なので、移動と同時に直す。
5. ビルドキャッシュ `.next/` を削除する（古い `app/` のパスを持っているため）。
6. ドキュメントの `app/`、`lib/`、`test/` の記述を `src/app/`、`src/lib/`、`src/test/` に直す。参照元のパスは「参照元の `src/...`」と書き分ける。`05_done/` の完了タスクは当時の記録なので書き換えない。
7. `README.md` か `docs/02_architecture.md` に、配置の約束を 1 か所だけ書く: コード（アプリとテスト）は `src/`、スキーマは `sql/postgres/`、運用スクリプトは `scripts/`。Rust は置かない。

## Non-scope

- `sql/postgres/` と `scripts/` の移動。スキーマと運用スクリプトであり、アプリコードではない。`scripts/apply-local-schema.sh` は `$(dirname "$0")/../sql/postgres/` を見るので、動かすと壊れる。
- 中身の変更、リファクタ、ファイル名の変更、TypeScript 化、`@/` alias の導入。
- `Makefile` の TODO 埋め。
- 16 RPC 名、API の URL（`/api/[name]`、`/api/ai/*`）の変更。

## Skeleton

移動後の repo 直下:

```text
speak-kit/
  src/
    app/          # Next.js App Router（画面と API route）
    lib/          # サーバ側の処理（dispatch、plan、quiz、talk、db、ai/）
    test/         # node --test
      fixtures/controlled_recall_grader_fixtures.json
  sql/postgres/   # migration
  scripts/        # ローカル運用
  docs/ env/ .claude/
  package.json next.config.mjs postcss.config.mjs jsconfig.json
```

## Plan

1. 着手前に `git status` を見る。`app/`、`lib/`、`test/` に未コミットの変更があれば先にコミットさせるか、owner に確認する（`05_done/2026-10-13-match-original-training-loop.md` の作業と衝突させない）。
2. 移動前の基準を取る: `npm test` の結果と、`npm run dev` で `http://localhost:3000/` と `POST /api/skill_trainer_get_today_plan_v2` の応答。
3. Scope 1・2 の `git mv`。
4. Scope 3・4 の `package.json` とテストの書き換え。
5. `.next/` を削除し、`npm test` と `npx next build` を通す。
6. `npm run dev` で、移動前と同じ画面と API の応答が返ることを見る（today → quiz → submit → progress のキー無し経路）。
7. Scope 6・7 のドキュメントの更新。
8. `rg -n "\`(app|lib|test)/|test/\*\.test" --glob '!docs/tasks/05_done/**' --glob '!node_modules' --glob '!.next' --glob '!src/**'` で、古いパスの残りが 0 件であることを見る。
9. Evidence を記録し、`04_verifying/` を経ずに `05_done/` へ移す（外部の signal を待つものが無い）。

## Acceptance Criteria

- repo 直下に `app/`、`lib/`、`test/` が無い。`src/` の下は `app/`、`lib/`、`test/` だけである。`.rs` ファイルが repo に 1 つも無い。
- `git log --follow src/lib/dispatch.mjs` で移動前の履歴が見える。
- `npm test` が移動前と同じ件数で全件通る。
- `npx next build` が成功し、ルートに `/` と `/api/[name]`、`/api/ai/*` が出る。`src/test/` 由来のルートは無い。
- `npm run dev` で `http://localhost:3000/` が開き、キー無しで today → quiz → submit → progress が移動前と同じ応答を返す。Anthropic へ接続しない。
- `src/test/ai-isolation.test.mjs` が `src/lib/quiz.mjs`、`src/lib/plan.mjs`、`src/lib/dispatch.mjs`、`src/app/api/[name]/route.js` を実際に読んでいる。検査文字列を `ai/client` にしても通る。
- Plan 8 の検索で、古いパスの残りが 0 件。

## Verification

```sh
cd /Users/kurosawa/Dev/speak-kit
ls -d app lib test 2>&1     # No such file or directory
ls src                      # app lib test
npm test
rm -rf .next && npx next build
git log --follow --oneline src/lib/dispatch.mjs | head
```

## Owner-only Decisions

- `03_active/` へ移す承認
決定済み:

- 2026-10-13: `test/` も `src/test/` に入れる（owner 指示）。
- 2026-10-13: フル Next.js なので Rust は置かない（owner 指示）。`src/domains/english_conversation.rs` は削除済み。

## Rollback Trigger

`npm test` か `npx next build` が移動前より悪くなり、パスの書き換えで直らないとき。`git mv` を戻して owner に返す。

## Evidence Required

- 移動前後の `npm test` の出力
- `npx next build` の route 一覧
- `npm run dev` での today → quiz → submit → progress の応答
- Plan 8 の検索結果（0 件）

## Notes

- コード内の相対パスは書き換え不要と見ているが、`npm test` と `npx next build` で確認するまでは確定扱いにしない。
