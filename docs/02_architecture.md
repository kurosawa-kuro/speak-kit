# 02 アーキテクチャ

出典は [英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md](./英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md)。製品の形は確定している。アプリ本体は未着手で、ディレクトリの切り方は着手時に決める。

着手順は、先にローカルで Golden Path を通すことである。Vercel、①用 Supabase、配布用 GitHub は別ステップである。詳細は [04_workflows.md](./04_workflows.md) と [08_release_runbook.md](./08_release_runbook.md)。

## 概要

```text
ブラウザ（Next.js）
  -> コア API Routes（テキストのフレーズ練習、学習記録）
  -> 学習記録の保存先

ブラウザ
  -> AI API Routes（任意。コアとは別エンドポイント）
  -> サーバー側 proxy
  -> Claude API
```

コアの経路は AI クライアントを import しない。AI の失敗はコアの経路へ入らない。

## 構成要素

| 構成要素 | 役割 | 状態 |
|---|---|---|
| Next.js（React） | 画面。テキストのみ。音声入出力は作らない | 未着手 |
| Next.js API Routes（コア） | テキストのフレーズ練習、学習記録・お気に入り。利用者は一人 | 未着手。AI クライアントを import しない |
| Next.js API Routes（AI） | 自由対話、文法／自然さフィードバック、シナリオ生成 | 任意。コアのあと |
| `lib/ai/isEnabled.ts`（例） | `hasAnthropicKey` の単一算出点。サーバーは `aiEnabled: boolean` だけを返す | パスは着手時。算出点は 1 箇所 |
| `lib/ai/client.ts`（例） | キーが無いときは `null` | 同上 |
| Supabase（Auth + Postgres） | 配布後の認証と学習記録 | 製品の保存先。①用 project は未所持。クラウド手順 |
| Vercel | 配布先のデプロイ | 別ステップ |
| Claude API | 任意の LLM。クライアントにキーを渡さない | 未設定が既定 |
| エージェントガイド | Codex / 他エージェント向けの repo ガイド | `AGENTS.md` |
| Claude ガイド | Claude Code の司令ルール | `CLAUDE.md` |
| タスク文書 | 一回性の作業計画・実装タスク | `docs/tasks/` |
| Claude skills | Claude Code で繰り返し使う作業手順 | `.claude/skills/` |

## 参照元

実装時の参照元アプリは `/Users/kurosawa/Dev/private-ops/apps/skill-trainer`（crate 名 `skill-trainer`、lib 名 `skill_trainer`）である。新しい挙動を発明せず、ここにあるものを限りなくコピーする。

| 参照元 | 扱い |
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
| 1. AI キー無しで開く | Next.js UI、`aiEnabled` の算出 | キーはサーバー側だけ。クライアントへは boolean | キー未設定を例外として落とすこと |
| 2. テキストでフレーズを練習する | UI とコア API | コア経路。マイク、再生、録音、AI route を呼ばない | 音声機能や AI 呼び出しをこの応答に直列で置くこと |
| 3. 学習記録を残す | コア API とローカル Postgres | schema は参照元 SQL の 28 ファイル。適用先は speak-kit 専用のローカル DB。記録の持ち主は利用者一人 | live の `DB_FLOW_URL`。①用 Supabase は未所持 |

- 新しい依存を足すときは、この表の Golden Path 上に AI・Vercel・Cloudflare を単一障害点として置かない。
- Golden Path 上の構成要素の変更は、[08_release_runbook.md](./08_release_runbook.md) の smoke と整合させる。

## 境界

- LLM 呼び出しはサーバー側 proxy のみ。クライアントに API キーを渡さない。
- コア機能の API route は AI クライアントを import しない。AI 機能は別エンドポイントに隔離する。
- キー有無は 1 箇所だけを参照する。クライアントにキーの有無を直接晒さない。
- AI 呼び出しは try/catch に置く。失敗時は構造化エラーを返し、プロセスとリクエストは落とさない。
- UI は Error Boundary で AI セクションを囲む。粒度（機能ごとか、セクション全体か）は未決。
- `aiEnabled` を起動時に固定するか、リクエストごとに再評価するかは未決。
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
