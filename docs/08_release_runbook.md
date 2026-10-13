# 08 リリース Runbook

自分用のクラウドは 2026-10-13 に立てた（[tasks/05_done/クラウドインフラ対応.md](./tasks/05_done/クラウドインフラ対応.md)）。

- 本番の URL: https://speak-kit.vercel.app （合言葉で守る。ユーザー名は何でもよい。合言葉は `env/secret.yaml` の `speakKitPassword`）
- Supabase: project `speak-kit`（ref `uhcfeyzwczepyjnqgwoq`、東京 `ap-northeast-1`）。DB のパスワードは `env/secret.yaml` の `supabaseDbPassword`
- Vercel: project `speak-kit`（関数は東京 `hnd1`）。環境変数は `SPEAK_KIT_DATABASE_KIND`、`SPEAK_KIT_DATABASE_URL`（接続プーラー 6543）、`SPEAK_KIT_PASSWORD`、`ANTHROPIC_API_KEY`。値は Vercel の管理画面（Settings → Environment Variables）で変える。変えたら再デプロイする

## リリース前

```bash
make test
git status --short
```

- `docs/tasks/03_active/` と `docs/tasks/04_verifying/` にリリース前の未完了 blocker が残っていないことを確認する。
- リリース対象 task の `Verification` に検証結果が残っていることを確認する。
- 未解決事項がある場合は、release blocker か follow-up かを task に明記する。
- ローカル smoke は `ANTHROPIC_API_KEY` を unset にして行う。

## デプロイ

DB の形を変えたときだけ、先に DB を当てる。そのあと教材の差分を見て反映し、デプロイする。

```bash
make cloud-db                        # sql/migrations のうち未適用のものを Supabase に当てる
make cloud-data                      # data/ の YAML と Supabase の差分を表示
sh scripts/cloud.sh data --apply     # 差分を反映
make cloud-deploy                    # 本番へデプロイ（vercel deploy --prod）
```

- GitHub への push では自動でデプロイされない。Vercel の GitHub 連携は、Vercel の管理画面で GitHub の Login Connection を足すまで使えない。
- Vercel のビルドは `next build`（出力先 `.next`）。`vercel.json` で指定している。ローカルの `npm run build` は `.next-build` に出す。
- アップロードしないもの（`env/secret.yaml`、`.env*`、`logs`）は `.vercelignore` にある。

配布（知人が自分のアカウントで立てる）の形は次のとおりで、まだ手順にしていない。

- 各自が自分の GitHub で clone または fork する。
- 自分の Vercel、自分の Supabase、任意で自分の Anthropic API キーを使う。
- 黒澤名義の課金・鍵・DB に、相手のアクセスや利用量を載せない。
- `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` でこのアプリを出さない。
- `INFRA_GITHUB_MEMO_REMOTE_PAT` で配布用リポジトリを作らない。
- live の `skill-trainer` へ、エンジン、マイグレーション、Retool publish を出さない。

## デプロイ後 smoke（Golden Path）

ローカルでも、クラウド手順に入ったあとでも、確認する一本は [01_requirements.md](./01_requirements.md) の Golden Path である。AI が無効のまま、この一本が切れていたら失敗とする。

| # | Golden Path ステップ | 確認方法（実行するコマンド / 操作） | 期待する観測結果 |
|---|---|---|---|
| 1 | AI キー無しで開く | `ANTHROPIC_API_KEY` unset でアプリを開く | AI は disabled と案内。クラッシュしない。音声 UI は無い |
| 2 | テキストでフレーズを練習する | 固定フレーズをテキストで最後まで答える | 入力と比較が完了する |
| 3 | 学習記録を残す | お気に入りまたは学習記録を保存し、再度開いて確認する | 記録が残っている。持ち主は利用者一人 |

- 中間段（ビルドが緑、ヘルスチェックが 200）だけで完了にしない。
- 任意の AI を有効にしたあとも、キーを無効にして 1〜4 が通ることを確認する。
- 401 / 429 / timeout のとき、コアの API が影響を受けないことを確認する。自動テストにするかは未決。

## ロールバック

- **トリガー**: smoke で Golden Path のいずれかのステップが期待結果に到達しない場合。ローカルなら、その変更を配布手順へ進めない。
- アプリ: Vercel の管理画面の Deployments で前のデプロイを選び、Instant Rollback する。CLI なら `npx vercel rollback`。
- DB: 当てた migration は戻さない。直すときは新しい migration を足して `make cloud-db` で当てる（当て済みのファイルを書き換えると `db-apply.sh` が止まる）。Supabase の無料プランのバックアップは、管理画面の Database → Backups で確かめる。

## リリース後タスク

- リリース後の確認事項は `docs/tasks/03_active/` または `docs/tasks/02_backlog/` に残す。
- 恒久的な運用手順になったものは `docs/runbooks/` へ昇格する。
