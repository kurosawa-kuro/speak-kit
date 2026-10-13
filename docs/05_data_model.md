# 05 データモデル

出典は [英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md](./英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md)。DB の形は 2026-10-13 のリファクタリング（[tasks/05_done/2026-10-13-architecture-refactor-db-first.md](./tasks/05_done/2026-10-13-architecture-refactor-db-first.md)）で作り直した。

## 設定

| 種別 | 方針 |
|---|---|
| 一般設定 | `env/config.yaml` または環境変数 |
| ローカル秘密情報 | `env/secret.yaml`（gitignore。コミットしない） |
| ローカル準備で参照してよい共有秘密 | Doppler `apps/dev` の `AI_ANTHROPIC_API_KEY` だけ。任意 Claude 用。プロセスへ `apps/dev` を丸ごと注入しない |
| 配布先の実行時秘密 | 各自の Vercel と Supabase。黒澤の Doppler に相手の利用量を載せない |
| アプリの Claude キー名 | `ANTHROPIC_API_KEY`。未設定が既定。Doppler 名 `AI_ANTHROPIC_API_KEY` とは別名 |

使わない鍵、まだ無い鍵は [04_workflows.md](./04_workflows.md) の表のとおり。`CLOUDFLARE_*` はこのアプリのデプロイに使わない。`INFRA_GITHUB_MEMO_REMOTE_PAT` でリポジトリを作らない。Vercel トークンと配布用 GitHub トークンは、この Doppler に無い。①用 project `speak-kit` のデータベースパスワードは `env/secret.yaml` の `supabaseDbPassword` である。

## 永続化

製品の認証と学習記録の保存先は、Supabase（Auth + Postgres、無料枠）である。①用 project `speak-kit`（South Asia / Mumbai、黒澤本人の一人用）は作成済みである。リージョンは Mumbai のままにする。この project は毎日の学習運用アプリではなく、live の `skill-trainer` とは別である。SQL の適用とクラウド手順は、ローカル Postgres で Golden Path が通ったあとである。Supabase のログイン機能も同じく後回しである。今のローカルアプリにはログイン画面もセッションも置かない。

ローカル先行の保存先は、speak-kit 専用のローカル Postgres の DB `speak_kit`（schema `skill_trainer`）である。テストは毎回作り直す `speak_kit_test` に向ける。アプリが接続してよいのはこの 2 つだけである（`src/server/config.mjs`）。接続文字列は `DB_FLOW_URL` ではない。live の学習者データベース、Job Control の Supabase、private-ops のローカル Postgres 正本には書かない。Supabase への載せ替えはクラウド手順である。

### DB の形の当て方

- DB の形は `sql/migrations/*.sql` である。1 本目は baseline（`20261013200000_baseline.sql`）。参照元から写した元の 29 本は `sql/archive/` に残してあるが、もう当てない。
- `sh scripts/db-apply.sh <DB 名>`（`make db`）が、まだ当てていないファイルを名前順に当てる。当てたファイルの名前とチェックサムは `public.schema_migrations` に残る。当て済みのファイルが書き換わっていたら止まる。
- 教材は `data/` の YAML が正本で、`npm run data:sync -- --apply` で DB に入れる（`data/README.md`）。空の DB でも、baseline → 教材の同期の 2 手で使える状態になる。

### 表

教材（YAML から入る。画面から増えるものも同じ形）:

| 表 | 中身 |
|---|---|
| `domains`・`domain_categories` | 分野（英会話 1 つ）とカテゴリ 5 つ |
| `capabilities` | 能力の一覧 9 つ。能力の列はここを FK で指す |
| `skill_concepts` | 表現（YAML の 1 件が 1 行） |
| `exercise_definitions`・`exercises` | 練習問題（版ごと）と、その出題用の行 |
| `assessment_contracts` | 採点契約。採点の版ごとの `rubric:<版>` と `quiz-choice`・`confusion-probe` |
| `quiz_items` | クイズ（選択肢と正解の ID） |
| `confusion_pairs`・`confusion_probes` | 混同ペア（教材の欄だけ。二つのラベルで一意）と確認問題 |
| `learning_policy_versions`・`learner_phase_gate_policies` | 計画の方針と Phase の合格条件 |

学習の記録（学習者ごとに `learner_key` を持つ。学習者の表は作らず、今は `default` の一人）:

| 表 | 中身 |
|---|---|
| `training_plans`・`training_plan_items` | 今日の計画 |
| `rendered_exercises` | 出した問題の文（出した時点のまま） |
| `training_attempts` | 回答（文字・クイズ・確認問題の共通の親） |
| `grading_observations`・`capability_evidence`（ビュー `effective_capability_evidence`） | 採点の結果と、能力の推定に使う証拠 |
| `grading_claims` | 後回しの採点を誰が進めているか（二重の採点を止める） |
| `weakness_diagnoses` | 弱点の診断 |
| `quiz_attempts`・`quiz_promotions` | クイズの回答と「選べるようになった」の記録 |
| `learner_confusion_state`・`learner_probe_state`（ビュー `learner_confusion_pairs`） | 混同ペアごとの学習の状態と、確認問題を最後に出した時刻 |
| `confusion_events` | 確認問題の回答と、回答から見つけた混同 |
| `conversation_sessions`・`conversation_turns`・`candidate_skills` | 会話と、言えなかった表現の候補 |
| `review_resets` | 「覚えたものを再チェック」の区切り |

設定と AI:

| 表 | 中身 |
|---|---|
| `learner_settings` | 学習者ごとの設定（今は「AI を使う」だけ） |
| `ai_usage` | AI の呼び出しごとの機能・モデル・トークン数・金額。1 日 2 ドル・1 か月 20 ドルの上限の判定に使う |

コアが保存するのは、学習記録とお気に入りである。会話ログを保存するか、プライバシー方針をどうするかは未決である。未決のままカラムやテーブルを足さない。

`speak-next` は開発中、live の学習者データベースへ書かない。吸収の日に一人の学習者の Evidence を二つにしない。何を反映し何を捨てるかは未決である。

## 関連タスク

- schema、migration、設定、永続化方式の変更は task に目的・移行手順・検証方法を残す。
- 破壊的変更や後方互換が絡む変更は、実装前に `docs/tasks/03_active/` で作業計画を固定する。
- 確定した migration 手順は `docs/runbooks/` または `08_release_runbook.md` へ昇格する。
