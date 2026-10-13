# 07 テスト戦略

受け入れ条件の出典はアイディアノートの「AI 機能の安全設計」。401 / 429 / timeout を自動テストに入れるか、手動検証のみにするかは未決である。未決のままテストの形を固定しない。

## 品質ゲート

```bash
make test
git diff --check
```

`make test` は `npm test`（`node --test --test-concurrency=1 src/test/*.test.mjs`）である。テストのファイルは設定の行（`learner_settings`）を共有するので、1 ファイルずつ流す。

## テストの DB

`npm test` は、テスト用の DB `speak_kit_test` を毎回空から作り直してから流す（`scripts/reset-test-db.sh`。`scripts/db-apply.sh` で `sql/migrations` を当て、`data/` の教材を入れる）。本物の `speak_kit` には書かない。DB に書くテストは `src/test/test-db.mjs` を最初に import し、接続先が `speak_kit_test` でなければ何も書かずに失敗する。

## テスト範囲

| 範囲 | テスト | 備考 |
|---|---|---|
| コア（キー unset） | `golden-path.test.mjs`、`settings.test.mjs`（choice path） | クイズと学習記録を、キー無しでも設定オフでも最後まで通す。音声 UI は無い。利用者は一人 |
| AI を使えないとき | `settings.test.mjs`、`ai-isolation.test.mjs`、`grade.test.mjs` | 設定オフ・キー無し・利用上限で、Anthropic へ接続しない。一致しない回答は「未採点」で返る |
| AI を待つ間のロック | `locks.test.mjs` | AI の応答を待つ間、会話の行をロックせず、トランザクションも開いたままにしない |
| AI 失敗の隔離 | 手動 | 401 / 429 / timeout が、コア側の他の API のレスポンスに影響しない。自動化するかは未決 |
| 結合 | `ai-isolation.test.mjs` | コアのファイル（quiz・plan・dispatch・API route）が AI クライアントを import していないこと |
| 教材 | `content.test.mjs` | YAML の検査と導出が、DB の規則と同じ結果になること |
| 修正の再発防止 | `fixes.test.mjs`、`domain.test.mjs`、`keys.test.mjs`、`names.test.mjs` | 再送・再判定・候補の承認・混同ペア・回答の見出し・日本語入力の Enter・RPC 名 |

AI まわりを変えたときの確認順:

1. `ANTHROPIC_API_KEY` を unset にした環境で `npm test` を通す。
2. キーを外した状態と設定オフで、画面のコアが壊れていないことを確認する。
3. 使えない表示と案内文を確認する。
4. 無効キーで 401 / 429 / timeout を起こし、コア側に影響が出ないか確認する。

## タスク完了条件

各 task は、完了前に必要な検証を `Verification` に残す。

- 実行したコマンド
- 結果の要約
- 実行できなかった検証と理由
- 残るリスク

テスト追加や期待値変更が必要な場合は、task に理由を書き、仕様変更なら先に該当 docs を更新する。
