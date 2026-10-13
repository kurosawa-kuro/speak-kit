# 08 リリース Runbook

クラウドへの配布は、ローカルで Golden Path が通ったあとの別ステップである。Vercel のトークン、①用の Supabase project、配布用の GitHub トークンは Doppler `apps/dev` に無い。この Runbook は、その手順を今は実行しない。

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

今のステップはローカル実行である。デプロイコマンドは書かない。

クラウド手順に入るときの形は、配布型だけである。

- 各自が自分の GitHub で clone または fork する。
- 自分の Vercel、自分の Supabase、任意で自分の Anthropic API キーを使う。
- 黒澤名義の課金・鍵・DB に、相手のアクセスや利用量を載せない。
- `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` でこのアプリを出さない。
- `INFRA_GITHUB_MEMO_REMOTE_PAT` で配布用リポジトリを作らない。
- live の `skill-trainer` へ、エンジン、マイグレーション、Retool publish を出さない。

「Deploy with Vercel」と GitHub テンプレート化で手数を減らす、という判断はある。テンプレートの範囲と、動画の手順との一致は未決である。

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
- クラウドの戻し方（前バージョン、データ整合性）は、デプロイ手順を書く段で残す。今は手順が無い。

## リリース後タスク

- リリース後の確認事項は `docs/tasks/03_active/` または `docs/tasks/02_backlog/` に残す。
- 恒久的な運用手順になったものは `docs/runbooks/` へ昇格する。
