# speak-kit

英会話コミュニティの知人へ、GitHub 経由で渡す個人の英会話練習アプリ。各自が自分の GitHub・Vercel・Supabase で立て、Anthropic API キーは任意で足す。

意図の台帳は [`docs/英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md`](docs/英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md)（更新日 2026-10-13）。状態は **cold / アイディア**。着手の承認ではなく、実装仕様でも Phase 合格条件でもない。正本へ昇格するときは、このノートを実装指示にせず、正本の変更案と実行 task に分ける。

## このリポジトリの位置

live の毎日の学習は private-ops 内の `skill-trainer` に残す。次の順で二つの独立リポジトリを作る。

| 順 | リポジトリ | 役割 |
|---|---|---|
| 現行 | private-ops 内 `skill-trainer` | Phase 1 の毎日の学習。二つのリポジトリの変更を受け取らない |
| 1 | **`speak-kit`（ここ）** | 英会話コミュニティへ配るアプリ。最初に作る |
| 2 | `speak-next` | `speak-kit` ができてから、このリポジトリをコピーして切る。Phase 2 移行の発展アプリ |

`speak-next` はコピーした時点で別リポジトリになる。その後の変更は `speak-kit` へ戻さない。`speak-kit` は配る相手のアカウントで動かす。`speak-next` は黒澤の Phase 2 開発である。相手の利用量と、黒澤の学習データ・鍵を同じ置き場に載せない。

`speak-next` を `skill-trainer` の fork にはしない。`speak-kit` と並行して新規にも作らない。コピーしてよい完成ライン、吸収する時期と中身は未決である。

## 参照元アプリ

実装時の参照元は `/Users/kurosawa/Dev/private-ops/apps/skill-trainer` である。挙動、`sql/postgres/`、参照元の `src/domains/` の文言を土台にし、そこから改良する（2026-10-13 owner。それまでは「限りなくコピーする」方針だった）。最初の改良は設定画面である。Rust の API（`dispatch` を含む参照元の `src/*.rs`）は、フル Next.js では crate のまま動かせないので、同じ挙動を Next.js API Routes へ書き直す。live の Postgres、Retool、`DB_FLOW_URL` には接続しない。

障害修正以外、エンジンのコード、マイグレーション、Retool publish を live に出さない。二つの開発・デプロイ・スキーマ変更は、今日の計画・回答・Evidence を止めない。

## 確定していること

owner 決定（2026-10-11）: 渡した相手のアカウント（API キー、ホスティング、DB）はすべて黒澤本人から切り離す。黒澤名義の課金・鍵・DB に相手のアクセスや利用量を載せない。構築・運用の手順は YouTube 動画として公開する。

実行基盤は Next.js である。参照元の Rust crate、Retool、ローカル Postgres、`DB_FLOW_URL` は実行基盤にしない。private-ops の個人運用（ローカル Postgres 正本、無料枠原理、API-less）は、この公開配布アプリへそのまま適用しない。

### 配布

各自が自分の GitHub アカウントで clone または fork し、自分の Vercel、自分の Supabase、自分の Anthropic API キーでデプロイする。単一ホスト型（黒澤がホストして友人に共有する形）は不採用。クオータ制限は置かない。各人が自分のキーと自分の無料枠で動かす。

「Deploy with Vercel」と GitHub テンプレートリポジトリ化で、clone・fork・env 設定の手数を最小にする。テンプレート化の範囲は未決。

動画の最初のステップは「まず AI 無しで動かす」で完結させる。「Anthropic キーを設定して AI 機能を有効化する」は後続ステップに分ける。

### 機能

| 区分 | 内容 | 必要なもの |
|---|---|---|
| コア（AI 無しで動く） | テキストのフレーズ練習、学習記録・お気に入り登録。音声は作らない | Supabase（Auth + DB）のみ |
| オプション | Claude との自由対話練習、入力した文章への文法／自然さフィードバック、シナリオの動的生成 | 上記 + Anthropic API キー |

対象外: private-ops の既存アプリとの結合、live への機能の書き戻し、本格的な商用化、AI フィードバックの精度。挙動のコピーは対象であり、ここが別に扱うのは「AI が無くても壊れない」ことである。

### 技術スタック

| レイヤー | 技術 |
|---|---|
| フロント | Next.js（React）。テキストのみ。各インスタンスは利用者一人 |
| バックエンド | Next.js API Routes。LLM 呼び出しはサーバー側 proxy のみ |
| LLM | Claude API（任意。クライアントに API キーを渡さない） |
| 認証 / DB | Supabase（Auth + Postgres、無料枠） |
| デプロイ | Vercel |

### AI が止まってもコアは通る

キー未設定、入力ミス、失効、無料枠超過、到達不可は配布先で日常的に起きる。AI 呼び出しの失敗が、テキストのフレーズ練習と学習記録を巻き込んで落とさない。

公開範囲とは、そのインスタンスを誰が使えるか、である。決定は一人だけのプライベートアプリである。同じインスタンスを他人に開かない。目的は AI キーの悪用防止である。知人への配布は、各自が自分の一人用インスタンスを立てる形である。

- AI を使えるかは、1 回の操作の最初に 1 度だけ決める（`src/server/ai/context.mjs` の `operationContext()`）。決め手は、画面の「設定」タブの「AI を使う」（`skill_trainer.learner_settings`）、キーの有無、今日と今月の AI の使用額（`skill_trainer.ai_usage`）の 3 つである。設定が「使わない」なら、キーがあっても Anthropic へ接続しない。使えない理由は「設定でオフ」「キー未設定」「利用上限に達した」の 3 つで、画面に出す文言は `src/app/_lib/labels.js` の 1 か所にある。
- AI の使用額は、応答の使ったトークン数から計算して残す。1 日 2 ドル・1 か月 20 ドル（`src/server/config.mjs`）に達すると、その日（その月）は AI を呼ばない。
- AI は `src/server/ai/client.mjs` の 1 か所からだけ呼ぶ。クイズ・計画・RPC の振り分け・API route は AI クライアントを import しない（`src/test/ai-isolation.test.mjs`）。
- AI の呼び出しは、DB のトランザクションの外で行う。失敗しても構造化したエラー（`ai_unavailable` など）を返し、プロセスとリクエストは落とさない。採点できなかった回答は「確認できませんでした」のまま残り、あとで再判定できる。

受け入れ条件、着手順、未決（フレーズ素材、会話ログ、開発用インスタンス、Error Boundary の粒度、`aiEnabled` の再評価、失敗系テストの自動化）はアイディアノートの「speak-kit」節にある。この README から決めない。音声と公開範囲は決まっている。

## 今の作業順の外

談話訓練（黒澤思考OS）、設計正本がすでに持っている Phase の要点、Phase 1 本番に入っている `aiAvailable` の記録は、アイディアノートの末尾に置く。別ノートには分けない。`speak-kit` のコア機能でもなく、新しい Phase 番号、Phase 1 Gate への要件追加、Skill / Exercise の登録でもない。

## いまのディレクトリ

```text
.
├── src/
│   ├── app/                 # 画面（Next.js App Router）と API route
│   │   ├── (main)/          # today / train / talk / records / settings の 5 画面。ヘッダーとタブは layout.js
│   │   ├── _components/     # 画面の共通部品
│   │   ├── _hooks/          # useRpc、採点待ちの問い合わせ、混同の確認問題
│   │   ├── _lib/            # 文言（labels）、数の見せ方（format）、RPC の呼び出し
│   │   └── api/[name]/      # RPC の入口。どの応答も同じ envelope
│   ├── server/              # サーバーの処理
│   │   ├── config.mjs       # 環境変数を読むのはここだけ（DB の接続先、AI のモデル・料金・上限など）
│   │   ├── dispatch.mjs     # RPC 名 → サービス。操作の文脈（AI を使えるか）をここで 1 度だけ作る
│   │   ├── services/        # 練習・回答・計画・会話・混同・候補・設定などの業務の処理
│   │   ├── content/         # 教材の YAML の検査・導出・DB への書き込み・書き出し
│   │   ├── ai/              # AI の窓口・プロンプト・採点・使用額
│   │   ├── domain/          # DB も AI も使わない純粋な関数
│   │   └── http/            # envelope、入力の検査、エラーログ
│   ├── cli/data.mjs         # npm run data:*
│   └── test/                # node --test
├── data/                    # 教材の正本（YAML）
├── sql/migrations/          # DB の形。scripts/db-apply.sh で当てる（sql/archive は元の 29 本）
├── scripts/                 # db-apply.sh、reset-test-db.sh など
├── docs/
├── env/                     # config.yaml（非機密）/ secret.yaml（ローカル秘密。コミット禁止）
└── Makefile
```

### 起動

```bash
make setup    # 依存を入れ、DB の形を当て、教材を入れる（最初の 1 回。何度流してもよい）
make build    # 本番ビルド（出力先は .next-build。開発サーバーと分けてある）
make start    # 本番ビルドで起動する（http://localhost:3000）
make dev      # 開発サーバーで起動する（コードを直しながら使うとき）
make test     # テスト
```

AI を使うときは、起動するシェルに `ANTHROPIC_API_KEY` を置く。黒澤の手元では Doppler から次のように渡す（`apps/dev` を丸ごと注入しない）。

```bash
doppler run -p apps -c dev --only-secrets AI_ANTHROPIC_API_KEY -- \
  sh -c 'export ANTHROPIC_API_KEY="$AI_ANTHROPIC_API_KEY"; unset AI_ANTHROPIC_API_KEY; exec npm run start'
```

想定外のエラーは `logs/server-errors.log` に 1 行ずつ残る（git には入れない）。Postgres の自動起動と、LAN から開けないようにすることは、まだ決めていない（`docs/tasks/02_backlog/実運用可能な状況かをレビュー依頼.md` の R3・R4）。

### 教材の管理

教材（表現・練習問題・クイズ・混同ペア）は [`data/`](data/README.md) の YAML で管理する。書き方は `data/README.md` にある。YAML を直したら、次の順で DB へ反映する。

```bash
npm run data:check              # 書き間違いの検査だけ（DB に触らない）
npm run data:sync               # DB との差分を見る（DB は変えない）
npm run data:sync -- --apply    # 反映する
```

画面から増えた教材（会話の候補の承認、混同ペアの登録）は DB に入る。`npm run data:export` で YAML に取り込める。

### テスト

`npm test` は、テスト用の DB `speak_kit_test` を毎回空から作り直し（`scripts/reset-test-db.sh`。schema と `data/` の教材を入れる）、そこに向けてテストを流す。本物の `speak_kit` には書かない。DB に書くテストは、接続先が `speak_kit_test` でなければ何も書かずに失敗する。

ハーネスの非機密設定は `env/config.yaml`、ローカル秘密情報は `env/secret.yaml`、チーム共有は Doppler（`doppler.yaml`）。配布先の実行時秘密（Supabase、任意の Anthropic キー）は、各自の Vercel と Supabase に置く。開発中の `speak-next` を含め、live の学習者データベースへは書かない。

## ドキュメント

- [`docs/英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md`](docs/英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md) — 意図の台帳（cold）
- [`docs/00_index.md`](docs/00_index.md) — 索引と権威順位
- [`docs/01_requirements.md`](docs/01_requirements.md) — 目的、スコープ、ユースケース
- [`docs/02_architecture.md`](docs/02_architecture.md) — 構成、境界、設計判断
- [`docs/04_workflows.md`](docs/04_workflows.md) — セットアップ、検証、運用フロー
- [`docs/07_test_strategy.md`](docs/07_test_strategy.md) — テスト方針

確定した範囲は [`docs/01_requirements.md`](docs/01_requirements.md) から [`docs/08_release_runbook.md`](docs/08_release_runbook.md) にある。未決と、今の作業順の外はアイディアノートに残す。アプリはローカルの Postgres で動いている。Vercel・①用 Supabase・配布用 GitHub は別ステップにする。
