# 04 ワークフロー

製品の手順は [01_requirements.md](./01_requirements.md) の Golden Path に従う。アプリ本体は未着手で、`make` の各ターゲットは足場である。

## 着手順

1. ローカルで、AI キー無しの Golden Path（テキストのフレーズ練習、学習記録）を最後まで通す。音声は作らない。インスタンスの利用者は一人である。
2. そのあと、任意の Claude を足す。キーを外してもコアが壊れていないことを確認する。
3. クラウド（Vercel、①用 Supabase、配布用 GitHub、YouTube の手順）は別ステップである。必要なトークンは Doppler `apps/dev` に無い。

動画の最初のステップも「まず AI 無しで動かす」で完結させる。Anthropic キーの設定は後続である。

## ローカル準備に使える秘密

置き場は private-ops の Doppler project `apps` / config `dev` である。値は書かない。`doppler run -p apps -c dev` でこのプロセスへ `apps/dev` を丸ごと注入しない。使ってよい名前だけを渡す。

| 鍵 | ローカル準備での扱い |
|---|---|
| `AI_ANTHROPIC_API_KEY` | 任意の Claude。アプリ側の env 名は `ANTHROPIC_API_KEY`。未設定がコアの既定。配布先の実行時キーにはしない |
| `CLOUDFLARE_ACCOUNT_ID` `CLOUDFLARE_API_TOKEN` | このアプリでは使わない。配布先は Vercel である |
| `INFRA_GITHUB_MEMO_REMOTE_PAT` | メモ帳の読み取り用。新規リポジトリの作成には使わない |

この Doppler に無いもの: Vercel のトークン、①用の Supabase project、配布用の GitHub トークン。Job Control 用の Supabase（`JOB_CONTROL_SUPABASE_*`）と `INFRA_SUPABASE_PAT` は、①用の project ではない。`speak-kit` の認証・DB に流用しない。

## セットアップ

```bash
make help
make setup
```

`make setup` / `make dev` / `make test` の中身は未記入である。アプリの依存導入コマンドは、着手時にこの Makefile へ書く。

## 作業開始

```bash
git status --short
```

1. [tasks/README.md](./tasks/README.md) を見る。
2. `docs/tasks/03_active/` から今日の task を選ぶ。
3. task に Scope / Plan / Acceptance Criteria があることを確認する。
4. 中規模以上なら Skeleton を固定してから実装する。
5. アイディアノートの未決を、この作業の中で決めない。

## ローカル実行

```bash
make dev
```

コアの確認は `ANTHROPIC_API_KEY` を unset にした状態で行う。任意の Claude を試すときだけ、`AI_ANTHROPIC_API_KEY` を `ANTHROPIC_API_KEY` に対応づける。

## テスト

```bash
make test
```

通すべき条件は [07_test_strategy.md](./07_test_strategy.md)。

## 作業終了

```bash
git diff --check
git status --short
```

- 実行した検証を task の `Verification` に残す。
- 未解決事項は task の `Notes` または `backlog/` に移す。
- 確定した仕様・手順・判断は docs 本体、runbook、ADR へ昇格する。
