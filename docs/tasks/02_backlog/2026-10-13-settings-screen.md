# 設定画面を作る（第一弾: AI を使うか使わないか）

## Weight Class

- Class: Medium
- Reason: 画面を 1 つ足し、AI の可否の判定を「キーの有無」から「設定とキーの有無」に変える。判定はほぼ全機能が通る（`aiEnabled()` の呼び出し元 10 ファイル）。設定を保存する表を `speak_kit` に足す。
- Limits: live DB、Supabase への SQL、Vercel、secret のコミットは 0。
- Owner approval required: yes。`03_active/` へ移す指示があるまで着手しない。

## Goal

利用者が画面から「AI を使う／使わない」を選べるようにする。使わないを選んだら、キーが設定されていても Anthropic へ一度も接続しない。あわせて、今後の設定画面で扱う項目の候補を一覧にし、どれから入れるかを owner が選べる状態にする。

## Context

- 方針の変更（2026-10-13 owner）: これまでは参照元（`private-ops/apps/skill-trainer`）を「限りなくコピーする」方針だった。今後は参照元から改良していく。設定画面は参照元に無い、最初の改良である。
- 今の AI の判定は `lib/ai/isEnabled.mjs` の 1 か所だけで、`ANTHROPIC_API_KEY` が空でなければ true になる。利用者が選ぶ手段は無い。
- `aiEnabled()` を呼んでいるのは `lib/ai/client.mjs`、`lib/ai/grade.mjs`、`lib/ai/features.mjs`、`lib/talk.mjs`、`lib/practice.mjs`、`lib/plan.mjs`、`lib/gate.mjs`、`lib/confusion.mjs`、`lib/dispatch.mjs`、`app/api/ai/status/route.js`。画面は `/api/ai/status` で状態を受け取る（`app/screens/practice/drill.js`、`app/ai/panel.js`）。
- `aiEnabled()` は同期関数で、環境変数しか見ない。設定を DB から読むと非同期になり、呼び出し元をすべて `await` に直す必要がある。
- 画面のタブは `app/ui/labels.js` の `SCREENS`（今日・練習・会話・記録）と `app/shell.js` で決まる。設定のタブは無い。
- 学習の調整値は `skill_trainer.learning_policy_versions` の active な行（`phase1-adaptive-v2`）の `config` にある。内容は `planner_budget {Train:2, Verify:1, Measure:2}`、`dose 1`、`target_success_rate 0.8`、`target_p50_latency_ms 3000`、`evidence_window_days 30`、`min_graded_count 3`、`retention_days [1,7,30]`、`output_style POLITE_NEUTRAL`。版で管理されていて、計画・診断の行が版を記録している。
- コードに固定されている値もある。クイズの安定判定の間隔 `SPACING = 3`（`lib/quiz.mjs`）、混同の確認間隔 1・3・7 日（`lib/confusion.mjs`）、日本時間 +9 時間と週の始まりの月曜（`lib/plan.mjs`）、AI のタイムアウト 20 秒と 45 秒、モデル `ANTHROPIC_MODEL || "claude-sonnet-5"`（`lib/ai/client.mjs`）。
- 利用者は一人（`learner_key = 'default'`）。ログインは無い。
- 2026-10-13 時点で、`lib/` に未コミットの変更がある（`03_active/2026-10-13-match-original-training-loop.md` の作業中）。また `02_backlog/2026-10-13-move-code-under-src.md` で `app/`・`lib/` を `src/` へ移す予定がある。このファイルのパスは移動前の表記である。

## Scope（第一弾: AI を使うか使わないか）

1. 設定を保存する表を足す。新しい migration `sql/postgres/<日時>_speak_kit_learner_settings.sql` で `skill_trainer.learner_settings`（`learner_key` を主キー、`ai_enabled boolean`、`updated_at`）を作り、`default` の行を入れる。参照元の 28 本は書き換えない。
2. AI の判定を 2 段に分ける。
   - `hasAnthropicKey()`: キーの有無。今の `aiEnabled()` の中身。
   - `aiEnabled()`: 設定が「使う」で、かつキーがあるときだけ true。設定は DB から読む。
   - `askClaude` は、送信の直前に必ず `aiEnabled()` を確かめる。設定が「使わない」なら `unavailable()` を返し、`fetch` を呼ばない。
3. `aiEnabled()` の呼び出し元 10 ファイルを `await` に直す。設定が「使わない」ときの挙動は、今のキー無しのときと同じにする（採点は AI 無しの経路、会話は固定の応答、候補抽出は `pending_retry`、混同ペアの下書きは使えない）。
4. 状態の API を広げる。`GET /api/ai/status` は `{ aiEnabled, keyConfigured, setting }` を返す。キーの値は返さない。
5. 設定を変える API を足す。`POST /api/settings` で `ai_enabled` を受け、保存後の状態を返す。コア機能の経路（`app/api/[name]/route.js`、`lib/dispatch.mjs`、`lib/plan.mjs`、`lib/quiz.mjs`）は AI クライアントを import しないまま保つ。
6. 設定画面を作る。`SCREENS` に「設定」を足し、`app/screens/settings.js` を置く。
   - 「AI を使う」のオン／オフ
   - キーの状態を読み取り専用で出す（「キー: 設定済み／未設定」）。キーが未設定なら、オンにしても使えないことを出す。
   - オフのとき、何が使えなくなるかを短く出す（文字回答の AI 採点、会話相手の返答、言えなかった表現の候補抽出、混同ペアの下書き）
7. 各画面の「AI が使えません」の表示で、理由を分ける。「設定で AI をオフにしています」と「API キーが未設定です」。
8. ドキュメント: `README.md`、`CLAUDE.md`、`docs/02_architecture.md` の「キー有無は 1 箇所で算出」の記述を、「設定とキー有無を 1 箇所で算出」に直す。「参照元を限りなくコピーする」方針を、「参照元を土台に改良する」に直す。

## Non-scope

- API キーを画面から入力・保存すること。キーはサーバー側の環境変数だけに置く。
- 第一弾以外の設定項目（下の「設定項目の候補」）。owner が選んだものを別タスクにする。
- ログイン、利用者ごとの設定（利用者は一人）。
- 音声。

## 設定項目の候補

2026-10-13 時点のコードと `learning_policy_versions` から洗い出した。優先度は提案であり、owner が決める。

### AI

| # | 項目 | 今の決まり方 | 提案 |
|---|---|---|---|
| 1 | AI を使う／使わない | キーがあれば使う | **第一弾（このタスク）** |
| 2 | API キーの状態の表示 | 画面に出ていない | 第一弾に含める（読み取り専用） |
| 3 | AI 機能ごとのオン／オフ（文字回答の採点、会話相手、候補抽出、混同ペアの下書き） | 全部まとめて | 次点。「採点は使わないが会話は使う」の需要があれば |
| 4 | モデルの選択 | 環境変数 `ANTHROPIC_MODEL`、既定 `claude-sonnet-5` | 次点。料金と質の選択になる |
| 5 | 1 日あたりの AI 呼び出し上限 | 無い | 次点。料金の歯止め |
| 6 | タイムアウト（20 秒、45 秒） | コード固定 | 画面に出さない。運用値 |

### 毎日の学習量と目標

`learning_policy_versions` の `config` にある値。版で管理されていて、計画と診断の行が版を記録している。画面から変えるときは今の行を書き換えず、新しい版を作って active を切り替える。

| # | 項目 | 今の値 | 提案 |
|---|---|---|---|
| 7 | 今日の計画の量（練習する・確かめる・測るの件数） | 2・1・2 | 次点。「今日は少なめ／多め」の需要が一番ありそう |
| 8 | 1 項目あたりの問題数（`dose`） | 1 | 7 と一緒に |
| 9 | 目標の正答率 | 80% | 後回し。診断の基準が変わる |
| 10 | 目標の反応時間 | 3 秒 | 後回し。同上 |
| 11 | 記録を数える期間 | 30 日 | 後回し |
| 12 | 判定に必要な最小回答数 | 3 回 | 後回し |
| 13 | 記憶確認の間隔 | 1・7・30 日 | 後回し |
| 14 | 回答の文体（`output_style`） | `POLITE_NEUTRAL` | 後回し。使われ方を先に確かめる |

### 練習とクイズ

| # | 項目 | 今の決まり方 | 提案 |
|---|---|---|---|
| 15 | クイズで「覚えた」とみなす条件（間を空けて 2 回正解、間隔 3 問） | `lib/quiz.mjs` の `SPACING = 3` | 後回し |
| 16 | 混同の確認問題の間隔 | 1・3・7 日（`lib/confusion.mjs`） | 後回し |
| 17 | 練習を開いたときの既定のモード、クイズの既定の種類 | 画面の初期値 | 次点。毎回選び直す手間が減る |
| 18 | 回答時間を画面に出すか | 出していない | 後回し |

### 会話

| # | 項目 | 今の決まり方 | 提案 |
|---|---|---|---|
| 19 | 既定の会話相手（講師・学習者同士・自由） | 毎回選ぶ | 次点 |
| 20 | 会話相手の話す速さ・難しさ | 無い（役割の文で固定） | 後回し。プロンプトの改良と一緒に |

### 表示と地域

| # | 項目 | 今の決まり方 | 提案 |
|---|---|---|---|
| 21 | タイムゾーン | 日本時間 +9 時間で固定（`lib/plan.mjs`） | 配布前に必要。日本以外の利用者で「今日」がずれる |
| 22 | 週の始まり | 月曜で固定 | 21 と一緒に |
| 23 | 画面の明暗 | 暗い配色だけ | 後回し |
| 24 | 音声（`env/config.yaml` の `audioEnabled: false`） | 未実装 | 音声を実装するときに |

### データ

| # | 項目 | 今の決まり方 | 提案 |
|---|---|---|---|
| 25 | 覚えたものを再チェック（`review_resets`） | 記録の画面にある | 設定へ移すか owner 判断 |
| 26 | 言えなかった表現の候補の承認／却下 | 会話の終了画面にある（参照元には無い） | 設定か記録に置き場を作る候補。`02_backlog/2026-10-13-close-remaining-original-gaps.md` の 34 と同じ論点 |
| 27 | 学習記録の書き出し | 無い | 配布前に検討 |
| 28 | 学習記録の全消去 | 無い | 取り消せない操作。owner 判断 |

## Skeleton

```text
app/screens/settings.js        # 設定画面（AI のオン／オフ、キーの状態）
app/api/settings/route.js      # POST: 設定の保存
app/api/ai/status/route.js     # GET: { aiEnabled, keyConfigured, setting }
lib/settings.mjs               # learner_settings の読み書き
lib/ai/isEnabled.mjs           # hasAnthropicKey() と async aiEnabled()
sql/postgres/<日時>_speak_kit_learner_settings.sql
```

## Plan

1. 着手前に `git status` を見る。`lib/` の未コミットの変更（進行中のタスク）と衝突しないようにする。`src/` への移動タスクと順序を決める（移動を先にするなら、パスは `src/` 付きで読み替える）。
2. migration を書き、`speak_kit` に適用する。`scripts/apply-local-schema.sh` は使わず、新しい 1 本だけ `psql -d speak_kit --single-transaction -f` で流す。
3. `lib/settings.mjs` と `lib/ai/isEnabled.mjs` を書き、呼び出し元を `await` に直す。
4. API（`/api/ai/status`、`/api/settings`）を書く。
5. 設定画面とタブを足し、各画面の「AI が使えません」の文言を理由別にする。
6. テストを足す。
   - 設定が「使わない」なら、キーがあっても `fetch` が呼ばれない（`globalThis.fetch` を差し替えて数える）
   - 設定が「使う」でもキーが無ければ使えない
   - キー無し・設定オフのどちらでも、choice の today → quiz → submit → progress が通る
7. Scope 8 のドキュメントを直す。
8. Acceptance Criteria を観測し、Evidence に残す。

## Acceptance Criteria

- 設定画面で AI をオフにすると、`learner_settings` の `ai_enabled` が false になる。再読み込みしてもオフのままである。
- キーを設定したままオフにしたプロセスで、練習の文字回答、会話の送信と終了、混同ペアの下書きを操作しても、Anthropic への接続が 0 回である（テストで `fetch` の呼び出し回数を数える）。
- オフのとき、各画面に「設定で AI をオフにしています」と出る。キー未設定のときは「API キーが未設定です」と出る。
- オンに戻すと、キーがあれば AI の採点と会話相手の返答が戻る。
- `/api/ai/status` の応答にキーの値が含まれない。
- `test/ai-isolation.test.mjs` を含め、`npm test` が全件通る。

## Owner-only Decisions

- `03_active/` へ移す承認
- AI の既定値。提案は「今と同じ（キーがあれば使う）」。配布版の既定を「使わない」にする案もある。
- 設定項目の候補 3〜28 から、次に入れるもの。提案は 7・8（今日の量）、17（練習の既定）、19（既定の会話相手）、21・22（タイムゾーン）。
- `src/` への移動タスクとの順序

## Stop / Ask Owner If

- 書き込み先が `speak_kit` 以外である
- `aiEnabled()` を非同期にすると、コア機能の経路（choice）が DB の読み込みを 1 回余分に待つ。体感で遅くなるなら、プロセス内のキャッシュを入れるか相談する
- 参照元の 28 本の migration を書き換えないと実現できない

## Evidence Required

- `learner_settings` の行（オン／オフの切り替え前後）
- オフ時に `fetch` が 0 回であることを示すテストの出力
- 設定画面と、各画面の理由別の表示
- `npm test` の出力
