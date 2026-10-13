# 02 アーキテクチャ

出典は [英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md](./英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md)。製品の形は確定している。アプリはローカルの Postgres で動いている。Vercel、①用 Supabase、配布用 GitHub は別ステップである（[04_workflows.md](./04_workflows.md)、[08_release_runbook.md](./08_release_runbook.md)）。

今の形は、2026-10-13 のリファクタリング（[tasks/05_done/2026-10-13-architecture-refactor-db-first.md](./tasks/05_done/2026-10-13-architecture-refactor-db-first.md)）で決めた。

## 概要

```text
ブラウザ（5 画面: 今日・練習・会話・記録・設定）
  -> POST /api/<RPC 名>（src/app/api/[name]/route.js。どの応答も同じ envelope）
  -> dispatch（入力の検査。操作の文脈を 1 度だけ作る）
  -> services（業務の処理。書き込みは 1 操作 1 トランザクション）
       -> Postgres（speak_kit.skill_trainer）
       -> ai/client（任意。トランザクションの外で呼ぶ）-> Claude API
```

- **操作の文脈**: 1 回の操作の最初に、学習者（`default`）、設定、キーの有無、今日と今月の AI の使用額、AI を使えるか、使えない理由（`setting_off` / `key_missing` / `limit_reached`）を決め、サービスへ渡す。1 つの操作の中で AI の可否を読み直さない。
- **AI はトランザクションの外**: 会話・採点・混同ペアの下書き・候補の抽出は、AI の応答を待ってから短いトランザクションで書く。AI を待つ間は DB のロックを持たない（`src/test/locks.test.mjs`）。
- **後回しの採点**: 一致しない回答は「採点待ち」で先に返し、応答のあとで `next/server` の `after()` から採点する。同じ回答の二重の採点は表 `grading_claims` で止める。画面は同じ送信内容を 2 秒ごとに送り直して結果を受け取る。
- **教材の正本は YAML**: `data/` の YAML を検査・導出して DB に書く。画面から増える教材（候補の承認、混同ペアの登録）も、YAML と同じ形を作って同じ導出と同じ書き込み（`src/server/content/write.mjs`）を通す。

## 構成要素

| 構成要素 | 役割 |
|---|---|
| `src/app/(main)/*/page.js` | 画面。App Router の実ルート（`/today`、`/train`、`/talk`、`/records`、`/settings`）。`/` は `/today` へ転送 |
| `src/app/_components/`・`_hooks/`・`_lib/` | 画面の共通部品、RPC のフック（`useRpc`、採点待ちの問い合わせ、確認問題）、文言と数の見せ方 |
| `src/app/api/[name]/route.js` | RPC の入口。`validation_error` は 400、`not_found` は 404、想定外の例外は 500 で `logs/server-errors.log` に残す |
| `src/server/config.mjs` | 環境変数を読む唯一の場所。DB の接続先と許す DB 名（`speak_kit` / `speak_kit_test`）、データの置き場の種類（local / supabase）、AI のモデル・料金・利用上限、エラーログの置き場 |
| `src/server/dispatch.mjs`・`rpc-names.mjs` | RPC 名 → サービス。元の skill-trainer と同じ 16 個と、speak-kit の 2 個（設定の読み書き） |
| `src/server/services/` | 練習（practice）、回答（attempt）、計画と記録（plan・planner・learning・gate）、クイズ（quiz）、会話（talk）、混同（confusion・boundary）、候補（candidates）、設定（settings） |
| `src/server/content/` | 教材の検査（schema）、導出（derive）、DB への書き込み（write）、差分の反映（sync）、書き出し（export） |
| `src/server/ai/` | AI の窓口（client）、操作の文脈（context）、使用額（usage）、採点（grade）、プロンプト（prompts） |
| `src/server/domain/` | 純粋な関数（答えの正規化、混同の目印、回答の見出しの判定、ハッシュ） |
| `src/cli/data.mjs` | `npm run data:check` / `data:sync` / `data:export` |
| `sql/migrations/` と `scripts/db-apply.sh` | DB の形。当てたファイルを `public.schema_migrations` に記録する |
| Supabase（Auth + Postgres） | 配布後の認証と学習記録。ログイン機能は後回し。今のローカルアプリにはログイン画面もセッションも置かない |
| Vercel | 配布先のデプロイ。別ステップ |
| Claude API | 任意の LLM。クライアントにキーを渡さない |

## 配置

- コード（アプリとテスト）は `src/` に置く。`src/app/`（画面と API route）、`src/server/`（サーバーの処理）、`src/cli/`、`src/test/`（`node --test`。fixture は `src/test/fixtures/`）。
- 教材は `data/`、DB の形は `sql/migrations/`、運用スクリプトは `scripts/` に置く。
- Rust は置かない。

## 参照元

実装時の参照元アプリは `/Users/kurosawa/Dev/private-ops/apps/skill-trainer`（crate 名 `skill-trainer`、lib 名 `skill_trainer`）である。ここにあるものを土台にし、そこから改良する（2026-10-13 owner。それまでは新しい挙動を発明せず限りなくコピーする方針だった）。

下の表のパスは、参照元 repo（`private-ops/apps/skill-trainer/`）の中のパスである。speak-kit の `src/` ではない。参照元の SQL は `sql/archive/` に写した 29 本を経て、今は `sql/migrations/` の baseline 1 本にまとめてある。

| 参照元の中のパス | 扱い |
|---|---|
| `sql/postgres/*.sql` | スキーマと seed をコピーする。適用先は live の `DB_FLOW_URL` ではない |
| `src/domains/english_conversation.rs` | プロンプト、固定文、カテゴリ文言をコピーする。Rust のモジュールとしては置かない |
| `src/testdata/` | 採点 fixture をコピーする |
| `src/skill_trainer_local.rs` の `dispatch` | RPC の名前と入出力を、Next.js API Routes の対応表にする |
| `src/skill_trainer_adaptive.rs` `src/skill_trainer_quiz.rs` `src/skill_trainer_confusion.rs` `src/envelope.rs` | 挙動の正本。Rust のままは動かさない |
| `src/main.rs` `Cargo.toml` | コピーしない。schema-apply は `DB_FLOW_URL` の admin であり、このアプリの起動経路ではない |

Rust API を crate 依存、`local-api-host` 経由、sqlx のままでは載せない。private-ops の個人運用ルール（ローカル Postgres 正本、無料枠原理、API-less）は、この公開配布アプリへそのまま適用しない。Retool 画面はこのディレクトリの外にあり、配布アプリの UI は Next.js である。

## Golden Path とアーキテクチャ

要件の Critical User Journey は [01_requirements.md](./01_requirements.md)。AI を単一障害点にしない。

| Golden Path ステップ | 通る構成要素 | 通る境界 / データ | 単一障害点（切れると journey が止まる） |
|---|---|---|---|
| 1. AI キー無しで開く | 画面、操作の文脈 | キーはサーバー側だけ。画面へは「使えるか」と理由だけ | キー未設定を例外として落とすこと |
| 2. テキストで練習する | 画面、`dispatch`、`services/quiz`・`practice`・`attempt` | クイズは AI を使わない。文字の回答は、完全一致ならその場で、ほかは AI（任意）で採点 | 音声機能や AI 呼び出しをこの応答に直列で置くこと |
| 3. 学習記録を残す | `services/*` とローカル Postgres | `sql/migrations` の DB。記録の持ち主は利用者一人（`learner_key = 'default'`） | live の `DB_FLOW_URL`。①用 Supabase への載せ替えは別ステップ |

- 新しい依存を足すときは、この表の Golden Path 上に AI・Vercel・Cloudflare を単一障害点として置かない。
- Golden Path 上の構成要素の変更は、[08_release_runbook.md](./08_release_runbook.md) の smoke と整合させる。

## 境界

- LLM 呼び出しはサーバー側の `src/server/ai/client.mjs` だけ。クライアントに API キーを渡さない。
- クイズ・計画・`dispatch`・API route は AI クライアントを import しない（`src/test/ai-isolation.test.mjs`）。
- AI を使えるかは操作の文脈の 1 か所で決める。設定がオフ、キーが無い、利用上限に達した、のどれかなら Anthropic へ接続しない。
- AI の失敗は構造化したエラー（`ai_unavailable` と理由、`ai_error`、`timeout` など）で返し、プロセスとリクエストは落とさない。
- 業務の判断（回答の見出しと再判定の可否 `verdict`・`canRegrade`、クイズの正解の ID、「見れば分かるが自力では出ない」、候補の承認内容）はサーバーが決める。画面は文言にするだけ。
- 各インスタンスは利用者一人のプライベートアプリである。公開範囲（誰が使えるか）は一人に閉じる。目的は AI キーの悪用防止である。
- 配布は各自の GitHub・Vercel・Supabase・任意の Anthropic キー。黒澤名義の鍵に相手の利用量を載せない。
- 非機密の設定は `env/config.yaml`。ローカル秘密情報は `env/secret.yaml`（コミットしない）。
- Doppler `apps/dev` からローカル準備に使ってよい鍵は [05_data_model.md](./05_data_model.md) の名前だけである。`apps/dev` をプロセスへ丸ごと注入しない。
- Codex が `.claude/rules/` や `.claude/skills/` を読む前提にしない。Codex / 他エージェント向けに永続させたい指針は `AGENTS.md` に置く。

## 配布とデプロイの判断

各自が自分の GitHub で clone または fork し、自分の Vercel、自分の Supabase、自分の Anthropic API キーでデプロイする。クオータ制限は置かない。手数を減らす手段は「Deploy with Vercel」と GitHub テンプレートリポジトリ化である。テンプレート化の範囲は未決。

この用途では Vercel を採る。Next.js の一次対応であり、GitHub 連携、env、ビルドまでを一つの手順にできる。Cloudflare（Pages / Workers）は、Next.js にアダプタと Edge runtime の制約が入り、動画の手順がずれやすい。Cloudflare を検討するのは、将来 Next.js 以外へ変える場合である。音声処理は作らない。Doppler にある Cloudflare の鍵は、このアプリのデプロイには使わない。

## 関連タスク

- 構造変更、責務移動、adapter 追加、共通化は、実装前に `docs/tasks/03_active/` へ task を作る。
- 中規模以上の変更では、task に Skeleton / Plan / Acceptance Criteria を書いてから実装する。
- 確定した設計判断は task から `docs/adr/` またはこの文書へ昇格する。
