# 05 データモデル

出典は [英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md](./英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md)。スキーマは未着手である。テーブルを先行して作らない。

## 設定

| 種別 | 方針 |
|---|---|
| 一般設定 | `env/config.yaml` または環境変数 |
| ローカル秘密情報 | `env/secret.yaml`（gitignore。コミットしない） |
| ローカル準備で参照してよい共有秘密 | Doppler `apps/dev` の `AI_ANTHROPIC_API_KEY` だけ。任意 Claude 用。プロセスへ `apps/dev` を丸ごと注入しない |
| 配布先の実行時秘密 | 各自の Vercel と Supabase。黒澤の Doppler に相手の利用量を載せない |
| アプリの Claude キー名 | `ANTHROPIC_API_KEY`。未設定が既定。Doppler 名 `AI_ANTHROPIC_API_KEY` とは別名 |

使わない鍵、まだ無い鍵は [04_workflows.md](./04_workflows.md) の表のとおり。`CLOUDFLARE_*` はこのアプリのデプロイに使わない。`INFRA_GITHUB_MEMO_REMOTE_PAT` でリポジトリを作らない。Vercel トークン、①用 Supabase、配布用 GitHub トークンは、この Doppler に無い。

## 永続化

製品の認証と学習記録の保存先は、Supabase（Auth + Postgres、無料枠）である。①用の Supabase project は未所持で、クラウド手順は別ステップである。

ローカル先行のあいだ、学習記録をどのファイルまたはどのローカル DB に置くかは未決である。live の学習者データベース、Job Control の Supabase、private-ops のローカル Postgres 正本には書かない。

コアが保存するのは、学習記録とお気に入りである。会話ログを保存するか、プライバシー方針をどうするかは未決である。未決のままカラムやテーブルを足さない。

`speak-next` は開発中、live の学習者データベースへ書かない。吸収の日に一人の学習者の Evidence を二つにしない。何を反映し何を捨てるかは未決である。

## 関連タスク

- schema、migration、設定、永続化方式の変更は task に目的・移行手順・検証方法を残す。
- 破壊的変更や後方互換が絡む変更は、実装前に `docs/tasks/03_active/` で作業計画を固定する。
- 確定した migration 手順は `docs/runbooks/` または `08_release_runbook.md` へ昇格する。
