# タスク

このディレクトリは、毎日の作業計画・調査・実装チェックリスト・完了証跡の実行ハブ。プロダクトの挙動・アーキテクチャ・データモデル・運用 runbook の正本ではないが、「今日何をするか」「次に何をするか」「何を完了したか」はここを正とする。

確定した仕様は `docs/specs/`、判断は `docs/adr/`、繰り返す運用は `docs/runbooks/`、再利用する作業手順は `.claude/skills/` に置く。

## 日次運用

1. 作業開始時に `03_active/`（と収束待ちの `04_verifying/`）を見る。
2. 今日やることを 1 つ選び、必要なら task file を作る。
3. 実装前に Scope / Plan / Acceptance Criteria を更新する。
4. 作業中の判断、検証コマンド、未解決事項を task file に残す。
5. 実装・基本検証が済んだら `04_verifying/` へ mv し、terminal signal（監視 probe 緑化など）を待つ。
6. signal を緑と観測できたら証跡を追記し、`05_done/` へ mv する。
7. 仕様として残すべき内容は `docs/specs/` や 01〜08 文書へ昇格する。
7. 判断理由として残すべき内容は `docs/adr/` へ昇格する。

`tasks/` は軽く保つが、軽すぎて運用履歴が消えるのは避ける。日々の作業で迷ったら、まず task に書いてから実装へ進む。

## 構成（番号付き5状態ライフサイクル）

タスクは番号付きの5状態フォルダで管理する。**番号が状態の順序と物理 mv の方向を表す**（task file は必ず番号が**上がる**向きにだけ移動し、状態を file 内の status 行で持たない）。

```text
01_idea → 02_backlog → 03_active → 04_verifying → 05_done
```

| ディレクトリ | 状態 | 用途 |
|---|---|---|
| `01_idea/` | 生アイデア | まだ task 化に値しない未整理の思いつき |
| `02_backlog/` | 未着手 | 形にはなったが未着手。**owner 判断待ち**もここで待つ（着手前に判断が要るもの） |
| `03_active/` | 進行中 | 進行中、または次に実行するもの（手を動かす段） |
| `04_verifying/` | 収束待ち | 実装・基本検証は完了したが、terminal state（監視 probe 緑化など）が未観測で done にできない状態 |
| `05_done/` | 完了 | terminal state を観測して完了。必要なら判断を ADR に昇格する |

### 04_verifying（収束待ち）の入退室ルール

`04_verifying` は「レビュー待ち」でも「判断待ち」でもない。**実装・基本検証は済んだが、反証可能で外部から観測できる terminal signal がまだ緑になっていない**ときだけ使う。

- **入室**: コード＋基本検証が完了し、残りは「タイミングを自分で制御できない terminal signal を観測するだけ」の状態（既存の監視 probe / health check の緑化、定期実行の完走、下流 surface への反映など）。
- **退室（→ `05_done/`）**: その signal を実際に緑と観測できた時だけ（Evidence Level ≥2）。どの probe / コマンド / surface で何を観測したかを task に記録し、file を `05_done/` へ物理 mv する。
- **判断待ちを混ぜない**: 「owner の判断待ち」は verifying ではなく `02_backlog/` へ。verifying が待つのは *evidence* であって *判断* ではない。
- signal が赤・古い場合は `03_active/` へ戻す。happy-state や陳腐化した signal で done にしない。

## タスクの粒度

- 1 task は、1 つの目的と 1 つの完了条件を持つ。
- 1 日で終わらない task は、今日やるチェック項目を `Plan` に切り出す。
- 大きすぎる task は `02_backlog/` に分割案を置き、実行単位だけ `03_active/` に出す。
- 仕様変更、設計判断、運用手順が固まったら、task に閉じ込めず docs 本体へ昇格する。

## 関連スキル

| スキル | 用途 |
|---|---|
| `.claude/skills/create-task` | ユーザー依頼からタスクノートを作る |
| `.claude/skills/execute-task` | 挙動とテストを保ったままタスクを実行する |
| `.claude/skills/review-task` | 範囲・根拠・クローズ可否の観点でタスクをレビューする |
| `.claude/skills/project-review` | プロジェクト構成と責務境界をレビューする |
| `.claude/skills/refactor-plan` | 早すぎる共通化を避けてリファクタを計画する |
| `.claude/skills/hallucination-check` | 結論前に主張をファイルとコマンドで検証する |
| `.claude/skills/skeleton-first` | テスト・実装の前にビジネスロジックレスのスケルトンで構造を固定する |

## Active

| ファイル | 用途 |
|---|---|
| [05_done/2026-10-13-match-original-training-loop.md](05_done/2026-10-13-match-original-training-loop.md) | 元の英会話学習から外れていた計画・記録・会話の 26 箇所。残りは 47 件のタスクへ引き継いで解消した |
| [05_done/2026-10-13-close-remaining-original-gaps.md](05_done/2026-10-13-close-remaining-original-gaps.md) | 元の英会話学習との残りの差分 47 件（6 は owner 判断で対象外）。弱点診断の作成と解消、記憶確認、混同検知、今日の計画モード、会話での使用記録まで観測した |
| [05_done/2026-10-13-move-code-under-src.md](05_done/2026-10-13-move-code-under-src.md) | プログラムコードを `src/app/`、`src/lib/`、`src/test/` へ移した。Rust は置かない。テスト 8 件とビルドのルートは移動前と同じ |
| [05_done/2026-10-13-settings-screen.md](05_done/2026-10-13-settings-screen.md) | 設定画面の第一弾。「AI を使う／使わない」を `learner_settings` に保存し、オフならキーがあっても Anthropic へ接続しない。各画面の表示を「設定でオフ」「キー未設定」に分けた。ほかの設定項目の候補 3〜28 は owner の選択待ち |
| [05_done/2026-10-13-content-yaml-in-data.md](05_done/2026-10-13-content-yaml-in-data.md) | 教材（表現 51・混同ペア 34）を `data/` の YAML に移した。`npm run data:check` / `data:sync` / `data:sync -- --apply` / `data:export` で検査・差分・反映・書き出しができる。追加・変更・停止を練習用 DB で観測した |
| [02_backlog/実運用可能な状況かをレビュー依頼.md](02_backlog/実運用可能な状況かをレビュー依頼.md) | ローカルで一人が毎日使えるかのレビュー。まだ不可。バックアップ無し、テストが本物の記録を汚す、LAN に開いている、再起動で動かない、未コミット、日本語入力の Enter で送信、の 6 つを先に直す |
| [02_backlog/2026-10-13-architecture-refactor-db-first.md](02_backlog/2026-10-13-architecture-refactor-db-first.md) | 設計レベルのリファクタリング案。DB の作り直しを先に行い、次にサーバーの層の分離、画面の実ルート化。すぐ直すべきバグ 10 件を含む。owner の段ごとの着手指示待ち |
| [05_done/2026-10-13-local-text-golden-path.md](05_done/2026-10-13-local-text-golden-path.md) | 参照元の SQL 28 本と dispatch 16 名をローカル Postgres `speak_kit` へ写し、キー無しの choice 経路を通した |
| [03_active/refactoring-candidates.md](03_active/refactoring-candidates.md) | 残りのクリーンアップ候補 |

## ルール

ここにタスク詳細を重複させない。各タスクファイルは軽く保つ:

```markdown
# タスクタイトル

## Goal

## Context

## Scope

## Skeleton

## Plan

## Acceptance Criteria

## Verification

## Notes
```

進行中の本作業は無い。次の候補は `02_backlog/` の設定画面と教材の YAML 管理で、どちらも owner の着手指示待ちである。クリーンアップ候補は
[03_active/refactoring-candidates.md](03_active/refactoring-candidates.md) で管理する。
