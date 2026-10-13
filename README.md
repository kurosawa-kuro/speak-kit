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

障害修正以外、エンジンのコード、マイグレーション、Retool publish を live に出さない。二つの開発・デプロイ・スキーマ変更は、今日の計画・回答・Evidence を止めない。

## 確定していること

owner 決定（2026-10-11）: 渡した相手のアカウント（API キー、ホスティング、DB）はすべて黒澤本人から切り離す。黒澤名義の課金・鍵・DB に相手のアクセスや利用量を載せない。構築・運用の手順は YouTube 動画として公開する。

本番 `skill-trainer` の適応訓練エンジン、Retool、ローカル Postgres は、このアプリの実装基盤にしない。private-ops の個人運用（ローカル Postgres 正本、無料枠原理、API-less）は、この公開配布アプリへそのまま適用しない。

### 配布

各自が自分の GitHub アカウントで clone または fork し、自分の Vercel、自分の Supabase、自分の Anthropic API キーでデプロイする。単一ホスト型（黒澤がホストして友人に共有する形）は不採用。クオータ制限は置かない。各人が自分のキーと自分の無料枠で動かす。

「Deploy with Vercel」と GitHub テンプレートリポジトリ化で、clone・fork・env 設定の手数を最小にする。テンプレート化の範囲は未決。

動画の最初のステップは「まず AI 無しで動かす」で完結させる。「Anthropic キーを設定して AI 機能を有効化する」は後続ステップに分ける。

### 機能

| 区分 | 内容 | 必要なもの |
|---|---|---|
| コア（AI 無しで動く） | 固定スクリプト／フレーズ集の読み上げ練習、自己録音→再生比較、学習記録・お気に入り登録 | Supabase（Auth + DB）のみ |
| オプション | Claude との自由対話練習、発話・文章への文法／自然さフィードバック、シナリオの動的生成 | 上記 + Anthropic API キー |

対象外: private-ops の既存アプリとの統合、本番 `skill-trainer` の機能移植、本格的な商用化、AI フィードバックの精度。ここが扱うのは「無くても壊れない」ことである。

### 技術スタック

| レイヤー | 技術 |
|---|---|
| フロント | Next.js（React）。音声入出力の実装方法は未決 |
| バックエンド | Next.js API Routes。LLM 呼び出しはサーバー側 proxy のみ |
| LLM | Claude API（任意。クライアントに API キーを渡さない） |
| 認証 / DB | Supabase（Auth + Postgres、無料枠） |
| デプロイ | Vercel |

### AI が止まってもコアは通る

キー未設定、入力ミス、失効、無料枠超過、到達不可は配布先で日常的に起きる。AI 呼び出しの失敗が、フレーズ読み上げ・録音比較・学習記録を巻き込んで落とさない。

- キー有無は 1 箇所で算出する（例: `lib/ai/isEnabled.ts` の `hasAnthropicKey`）。全 AI 関連ルートとコンポーネントはそこだけを参照する。クライアントにはキーの有無を晒さず、サーバーが `aiEnabled: boolean` を返す。
- コア機能の API route は AI クライアントを import しない。AI 機能は別エンドポイントに隔離する。
- AI 呼び出しは try/catch に置く。失敗時は構造化エラーを返し、プロセスとリクエストは落とさない。
- UI は Error Boundary で AI セクションを囲む。AI 無効時は disabled 表示と「Anthropic キーを設定すると使えます」の案内に差し替える。

受け入れ条件、着手順、未決（フレーズ素材、公開範囲、音声実装、会話ログ、開発用インスタンス、Error Boundary の粒度、`aiEnabled` の再評価、失敗系テストの自動化）はアイディアノートの「speak-kit」節にある。この README から決めない。

## 今の作業順の外

談話訓練（黒澤思考OS）、設計正本がすでに持っている Phase の要点、Phase 1 本番に入っている `aiAvailable` の記録は、アイディアノートの末尾に置く。別ノートには分けない。`speak-kit` のコア機能でもなく、新しい Phase 番号、Phase 1 Gate への要件追加、Skill / Exercise の登録でもない。

## いまのディレクトリ

アプリ本体は未着手。あるのは Thin Harness の足場である。

```text
.
├── env/                 # config.yaml（非機密）/ secret.yaml（ローカル秘密。コミット禁止）
├── docs/                # ドキュメント。意図の台帳は docs/ 直下のアイディアノート
├── .claude/             # Claude Code の rules / skills / hooks
├── Makefile             # setup / dev / test などは足場。中身は未記入
├── README.md
├── CLAUDE.md
└── AGENTS.md
```

```bash
make setup    # 依存取得 + ビルド（現状は TODO）
make dev      # 開発サーバー起動（現状は TODO）
make test     # テスト（現状は TODO）
```

ハーネスの非機密設定は `env/config.yaml`、ローカル秘密情報は `env/secret.yaml`、チーム共有は Doppler（`doppler.yaml`）。配布先の実行時秘密（Supabase、任意の Anthropic キー）は、各自の Vercel と Supabase に置く。開発中の `speak-next` を含め、live の学習者データベースへは書かない。

## ドキュメント

- [`docs/英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md`](docs/英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md) — 意図の台帳（cold）
- [`docs/00_index.md`](docs/00_index.md) — 索引と権威順位
- [`docs/01_requirements.md`](docs/01_requirements.md) — 目的、スコープ、ユースケース
- [`docs/02_architecture.md`](docs/02_architecture.md) — 構成、境界、設計判断
- [`docs/04_workflows.md`](docs/04_workflows.md) — セットアップ、検証、運用フロー
- [`docs/07_test_strategy.md`](docs/07_test_strategy.md) — テスト方針

確定した範囲は [`docs/01_requirements.md`](docs/01_requirements.md) から [`docs/08_release_runbook.md`](docs/08_release_runbook.md) にある。未決と、今の作業順の外はアイディアノートに残す。アプリ本体は未着手である。先にローカルで Golden Path を通し、Vercel・①用 Supabase・配布用 GitHub は別ステップにする。
