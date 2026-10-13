# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際の最小ガイド。

## Source of Truth

- Project overview: `README.md`
- Documentation index: `docs/00_index.md`
- Requirements: `docs/01_requirements.md`
- Architecture: `docs/02_architecture.md`
- Test strategy: `docs/07_test_strategy.md`
- Harness 全体像: `.claude/README.md`（このリポジトリの AI 制御一式）
- Harness アーキ本体: `docs/specs/kurosawa-thin-harness-architecture.md`（tool-agnostic マスター）＋ repo 固有 instantiation（`docs/specs/{runtime-protocol,capability-boundary,change-boundary,evidence-policy,judgment-memory}.md`）
- 判断日誌 / 蒸留記憶: `docs/decisions/decision-log.md` / `docs/memory/`
- Feature spec（実装前・1 機能ごと）: `SPEC.md`
- Task notes: `docs/tasks/`

**spec の使い分け（混同しない）**: `SPEC.md` = 今から作る 1 機能の使い捨て実装スペック（公式 Explore→Plan→Implement→Commit の入口、新セッションで実行）。`docs/specs/` = 恒久アーキ設計マスター。`docs/tasks/` = タスク台帳。`docs/英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md` = 意図の台帳（cold / アイディア）。着手承認でも実装仕様でも Phase 合格条件でもない。

## このリポジトリ

`speak-kit` は英会話コミュニティへ配るアプリ。概要・確定スタック・配布型は `README.md`。同じ主題の別アイディアノートは作らない。

作業してよいのは、owner がこのセッションで指示した範囲だけである。確定した範囲は `docs/01_requirements.md` から `docs/08_release_runbook.md` にある。アイディアノートの未決（フレーズ素材、会話ログ、テンプレート化、`speak-next` の完成ラインと吸収）を実装で埋めない。音声入出力は作らない。各インスタンスは利用者一人のプライベートアプリであり、目的は AI キーの悪用防止である。先にローカルで Golden Path を通す。Vercel、①用 Supabase、配布用 GitHub は別ステップである。`speak-next` は、`speak-kit` ができてからこのリポジトリをコピーして切る。今は切らない。コピー後の変更を `speak-kit` へ戻さない。

実装の参照元は `/Users/kurosawa/Dev/private-ops/apps/skill-trainer`。挙動、`sql/postgres/`、参照元の `src/domains/` の文言を土台にし、そこから改良する（2026-10-13 owner。それまでは限りなくコピーする方針だった）。Rust API（参照元の `src/*.rs`）はフル Next.js では crate のまま載せず、同じ挙動を Next.js API Routes へ書き直す。live の毎日の学習は private-ops 内 `skill-trainer` に残す。障害修正以外、エンジン、マイグレーション、Retool publish を live に出さない。live の学習者データベースと `DB_FLOW_URL` へ書かない。private-ops の個人運用ルールをこの公開配布アプリへそのまま適用しない。

談話訓練、新しい Phase 番号、Phase 1 Gate の変更、Skill / Exercise の登録は、このリポジトリの作業順に載せない。

## コマンド

```bash
make setup       # 依存を入れ、DB の形を当て、教材を入れる
make dev         # 開発サーバー（出力先 .next）
make build       # 本番ビルド（出力先 .next-build）
make start       # 本番ビルドで起動（ポート 3000）
make test        # テスト（speak_kit_test を作り直して流す）
make db          # sql/migrations を speak_kit に当てる
make data-check  # data/ の YAML を検査
make data-sync   # YAML と DB の差分を表示（反映は npm run data:sync -- --apply）
```

## アーキテクチャ

アプリはローカルの Postgres で動いている。構成は `docs/02_architecture.md`、DB の形は `docs/05_data_model.md`。製品の形は次のとおり。

- フロントは Next.js（React）。バックエンドは Next.js API Routes。デプロイは Vercel。認証と DB は Supabase（Auth + Postgres）。
- LLM は Claude API で任意。呼び出しはサーバー側 proxy のみ。クライアントに API キーを渡さない。
- コア（テキストのフレーズ練習、学習記録・お気に入り）は Anthropic キー無しで最後まで通る。読み上げ、録音、STT、TTS は作らない。AI 機能は別エンドポイントに隔離し、コアの route は AI クライアントを import しない。
- AI を使えるかは、設定（`learner_settings.ai_enabled`）とキー有無と AI の利用上限（1 日 2 ドル・1 か月 20 ドル）から、操作の文脈（`src/server/ai/context.mjs`）の 1 箇所で算出する。設定がオフなら、キーがあっても Anthropic へ接続しない。サーバーはキーの値を返さず、`aiEnabled`、キーの設定済み／未設定、使えない理由だけを返す。401 / 429 / 5xx / timeout は該当 AI 呼び出しだけの失敗にする。
- 各自が自分の GitHub・Vercel・Supabase・任意の Anthropic キーでデプロイする。黒澤名義の課金・鍵・DB に相手の利用量を載せない。
- ハーネスの非機密設定は `env/config.yaml`、ローカル秘密情報は `env/secret.yaml`、チーム共有は Doppler (`doppler.yaml`)。配布先の実行時秘密は各自の Vercel / Supabase に置く。
- 設計・運用ドキュメントは `docs/` 配下。権威順位と更新規約は `docs/00_index.md` に従う。
- パス別ルールは `.claude/rules/` 配下に置く。
- 一回性の作業計画は `docs/tasks/`、繰り返し使う作業手順は `.claude/skills/` に置く。

## 作業ルール

- 推測でコードを書かない。コマンドを書いたら実際に実行して確認する。
- 仕様変更は連動する `docs/` とテストを同一 PR で直す。drift を作らない。
- 既存の関数・ユーティリティ・パターンを優先的に再利用する。
- task note を仕様の正本にしない。確定内容は `docs/specs/`、`docs/adr/`、`docs/runbooks/` に昇格する。アイディアノートを実装指示にしない。
- コア機能を先に通す。`ANTHROPIC_API_KEY` を unset にした状態で、テキストのフレーズ練習と学習記録が完了することを確認してから AI 機能を足す。
- AI 無効時の UI は disabled と案内文にする。AI セクションは Error Boundary で囲む。
- コミットメッセージは、何をしたかを日本語 1 行で書く。`wip` だけのメッセージにしない。
- `npm test` は `speak_kit_test` を作り直して流す。本物の `speak_kit` に向けてテストを流さない。
- **Scope invariant（常時）**: 作業中に Goal/Scope 外の変更・前提崩れ・追加副作用・docs と実装の矛盾を見つけたら即実装しない。`control-change` で分類するか follow-up task に残す。「ついで修正/共通化/改名」は scope creep。

## AI Runtime Protocol（薄い・常時）

Thin Harness の常時手順。詳細は `.claude/README.md` と `docs/specs/runtime-protocol.md`、停止条件は同 §「停止して owner に確認する」。

> **このハーネスは重い既定で出荷されている。** 新規生成直後は、まず skill `harness-trim` を1回回し、このプロジェクトの脅威モデルに合わせて hooks / rules / permissions / agents / skills を keep・delete・adjust する（削除は想定手順で scope creep ではない）。以降は下記の常時手順に従う。

1. Goal / Scope / Done を言い直す。
2. Weight Class を判定（Light / Standard / Heavy → `classify-task`）。Light は以降の重い手順をスキップしてよい。
3. owner-only 判断・保護 capability・allowed/forbidden paths を確認（`scan-decisions` / `capability-boundary.md` / `change-boundary.md`）。
4. Standard/Heavy の新機能は **plan モードで探索（編集せず読む）→ `SPEC.md` を自己完結で記述（触るファイル/IF 名指し・Non-scope・末尾 E2E 検証）→ 可能なら新セッションで実行**。その後 skeleton + TDD contract を先に固める（`plan-skeleton`）。
5. scope 内で最小変更を当てる。複数 attempt が要るなら停止条件付きで回す（`reconcile-task`）。
6. 必要 Evidence Level（≥2、本番は4）で検証（`verify-completion` / `evidence-policy.md`）。
7. scope 拡大・保護境界接触・二度違う理由で検証失敗 → 停止して owner へ。
8. 非自明な判断を下した時だけ記録（`log-decision`）。
