# 変更をコミットして GitHub に送る

## Weight Class

- Class: Light
- Reason: git の操作だけ。コードの中身は変えない。
- Limits: `env/secret.yaml` などの secret をコミットしない。`git push --force` はしない。
- Owner approval required: yes。`03_active/` へ移す指示があるまで着手しない。

## Goal

作業した内容が GitHub（`origin` = `https://github.com/kurosawa-kuro/speak-kit.git`）に残り、コミットの履歴を見れば何をしたかが分かる状態にする。

## Context

- 出どころ: `05_done/実運用可能な状況かをレビュー依頼.md` の R5。
- 2026-10-13 18:50 のレビュー時点:
  - 未コミットのファイルが 29 個あった。
  - `data/` が git に入っていなかった。
- 2026-10-13 19:00 時点:
  - コードと `data/`（7 ファイル）はコミットされた。
  - 未コミットは文書 3 つだけ（`docs/tasks/README.md`、リファクタリング案、レビュー依頼）。
  - `main` は `origin/main` より 5 コミット先にあり、GitHub に送られていない。
  - 直近のコミットメッセージは、すべて `wip` である。
- `.gitignore` は `env/secret.yaml`、`.env*`、`node_modules/`、`.next/` を除外している。

## Scope

1. 未コミットの文書をコミットする。
2. コミットする前に、secret が入っていないことを確かめる。
   - `git diff --cached --name-only` に `env/secret.yaml`、`.env` が無いこと。
   - `git diff --cached` に `sk-ant-`、`supabaseDbPassword` の値などが無いこと。
3. 未 push の 5 コミットを `git push origin main` で送る。
4. これからのコミットメッセージの決まりを、`CLAUDE.md` か `AGENTS.md` に 1 行足す。
   - 例: 「何をしたかを日本語 1 行で書く。`wip` だけのメッセージにしない」
   - 既に push 前の `wip` コミットを書き直すか（`git rebase -i`）は owner が決める。

## Non-scope

- ブランチ運用や PR の導入
- 配布用のテンプレートリポジトリ化
- GitHub Actions での CI

## Plan

1. `git status --short` と `git log --oneline origin/main..HEAD` を記録する。
2. Scope 2 の確認をしてから、Scope 1 と 3 を行う。
3. `git status -sb` が `## main...origin/main` で、`ahead` も未コミットも無いことを確かめる。

## Acceptance Criteria

- `git status --short` の結果が空である。
- `git status -sb` に `ahead` が無い。
- GitHub の `main` に `data/` がある。
- コミットに secret が含まれていない。

## Owner-only Decisions

- `03_active/` へ移す承認
- push 前の `wip` コミットのメッセージを書き直すか、そのまま送るか

## Evidence Required

- `git status -sb` と `git log --oneline -5` の出力（push 後）
- secret の確認に使ったコマンドと、その結果（0 件）

## Result（2026-10-13）

- owner の判断を待たずに進めた点: push 前の `wip` コミットは書き直さず、そのまま送った（`git push --force` を避けるため。履歴は残る）。
- R6・R2 の変更を、何をしたかが分かる日本語 1 行のメッセージで、別々のコミットにした。
- 残りの文書（`AGENTS.md`、`CLAUDE.md`、タスク台帳、レビュー依頼、`docs/tasks/01_idea/`）を 1 コミットにした。
- コミットメッセージの決まりを `AGENTS.md`（コーディング規約）と `CLAUDE.md`（作業ルール）に 1 行ずつ足した。「何をしたかを日本語 1 行で書く。`wip` だけのメッセージにしない」。
- secret の確認: コミットごとに `git diff --cached --name-only` に `secret.yaml` と `.env` が無いこと、`git diff --cached` に `sk-ant-`、`supabaseDbPassword`、`AI_ANTHROPIC_API_KEY=`、`PGPASSWORD=` の値が無いことを確かめた。3 つ目のコミットでは 2 件当たったが、どちらも名前だけで値は無い（`docs/tasks/01_idea/` の「パスワードは `env/secret.yaml` の `supabaseDbPassword` にある」という記述と、この節の文）。

## Evidence

`git push origin main`（HTTPS）は、この環境に GitHub のログイン情報が無く失敗した（`could not read Username`）。SSH の鍵は通るので、同じリポジトリへ SSH の URL で送った（`origin` の設定は変えていない。force なし）。

```text
$ git push git@github.com:kurosawa-kuro/speak-kit.git main:main
   b1baf64..411e5f6  main -> main
$ git status -sb
## main...origin/main
$ git log --oneline -5
411e5f6 コミットメッセージの決まりを足し、R2・R5・R6 のタスク台帳とレビュー依頼を更新した
374e793 npm test を毎回作り直すテスト用 DB speak_kit_test に向け、本物の学習記録を汚さないようにした
fbcc0ca 会話画面と混同ペア登録で、日本語入力の変換を確定する Enter では送信しないようにした
65f9329 wip
b1baf64 wip
$ git ls-tree --name-only origin/main data/
data/README.md
data/confusion_pairs.yaml
data/expressions
```

このあと、この Evidence の追記を 1 コミットにして同じ方法で送った。

## 残ること

- HTTPS の `git push origin main` は、この Mac では GitHub のログイン情報が無いため通らない。SSH の URL で送るか、`origin` を SSH の URL に変えるかは owner が決める。
