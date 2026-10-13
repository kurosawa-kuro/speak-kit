# AGENTS.md

AI コーディングエージェント（Claude Code / Codex / GitHub Copilot 等）共通の作業ガイド。
Codex は作業前にこのファイルを読むため、ここには repo 共通方針のみ記す。
ツール固有の指示は各ツールのファイル（例: Claude Code は `CLAUDE.md`）に置く。

## プロジェクト概要

`speak-kit` は、英会話コミュニティの知人へ GitHub 経由で渡す個人の英会話練習アプリ。各自が自分の GitHub・Vercel・Supabase で立てる。Claude API は任意で、キーが無くてもコア（フレーズ読み上げ、録音比較、学習記録・お気に入り）は最後まで通る。

意図の台帳は `docs/英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md`（2026-10-13、cold / アイディア）。確定した範囲は `docs/01_requirements.md` から `docs/08_release_runbook.md` にある。概要は `README.md`。同じ主題の別アイディアノートは作らない。未決は実装で埋めない。先にローカルで Golden Path を通す。クラウド（Vercel、①用 Supabase、配布用 GitHub）は別ステップである。

- 主要技術: Next.js（React + API Routes）、Supabase（Auth + Postgres）、Vercel、任意の Claude API（サーバー側 proxy のみ）
- 配布: 各自のアカウント。黒澤名義の課金・鍵・DB に相手の利用量を載せない。単一ホスト型は不採用
- 次段階: `speak-kit` ができてから、このリポジトリをコピーして `speak-next` を切る。今は切らない。コピー後の変更は `speak-kit` へ戻さない
- live: 毎日の学習は private-ops 内 `skill-trainer` に残す。障害修正以外、エンジン・マイグレーション・Retool publish を live に出さない。live の学習者データベースへ書かない
- 実装基盤にしないもの: 本番の適応訓練エンジン、Retool、ローカル Postgres。private-ops の個人運用ルールをこの公開配布アプリへそのまま適用しない
- 作業順の外: 談話訓練、新しい Phase 番号、Phase 1 Gate の変更、Skill / Exercise の登録

アプリ本体は未着手。`make` の各ターゲットは足場で、中身は未記入。

## セットアップ / 主要コマンド

```bash
make setup    # 依存取得 + ビルド
make dev      # 開発サーバー
make test     # テスト
make fmt      # フォーマット
```

## コーディング規約

- 既存のコード・命名・パターンに合わせる。新規導入より既存の再利用を優先する。
- 変更後はテストとフォーマッタを実行してから完了とする。
- 非機密の設定値は `env/config.yaml`、ローカル秘密情報は `env/secret.yaml`、チーム共有は Doppler (`doppler.yaml`)。秘密情報をコミットしない。配布先の Supabase と任意の Anthropic キーは、各自の Vercel / Supabase に置く。クライアントに API キーを渡さない。
- コアの API route は AI クライアントを import しない。キー有無は 1 箇所で算出し、クライアントへは `aiEnabled: boolean` だけを返す。401 / 429 / 5xx / timeout でコア機能を落とさない。
- アイディアノートを実装指示にしない。正本へ昇格するときは、変更案と実行 task に分ける。

## ドキュメント

設計・仕様・運用は `docs/` 配下を参照。更新規約と権威順位は `docs/00_index.md` に従う。
仕様レベルの変更は連動するドキュメントを同一 PR でまとめて直す。

## Codex / Claude Code

- `AGENTS.md` は Codex / 他エージェント共通ガイド。
- `CLAUDE.md` は Claude Code の司令塔。
- `.claude/rules/` と `.claude/skills/` は Claude Code 用。Codex が読む前提にしない。
- Codex 向けに永続させたい recurring な指摘やミス防止は、この `AGENTS.md` または nested `AGENTS.md` に小さく追加する。

## Harness（AI 制御一式）

- このリポジトリの AI 制御の全体像は `.claude/README.md`（Kurosawa Thin Harness Architecture の実装）。
- アーキ本体（tool-agnostic マスター）は `docs/specs/kurosawa-thin-harness-architecture.md`、repo 固有の脅威モデルは `docs/specs/{capability-boundary,change-boundary,runtime-protocol,evidence-policy,judgment-memory}.md`。
- permissions の ask/deny と保護パスは脅威モデルで決める。**他プロジェクトの設定をそのまま移植しない**。

## Task / Skill

- 一回性の作業計画・調査メモ・実装タスクは `docs/tasks/` に置く。
- Claude Code で繰り返し使う作業手順は `.claude/skills/` に置く（classify-task → create-task → scan-decisions → plan-skeleton → execute-task → verify-completion → review-task のライフサイクル）。
- Codex repo skills を本格運用する場合は `.agents/skills/` を任意追加する。標準生成物には含めない。
- task note を仕様の正本にしない。確定した仕様は `docs/specs/`、判断理由は `docs/adr/`、運用手順は `docs/runbooks/` に昇格する。
