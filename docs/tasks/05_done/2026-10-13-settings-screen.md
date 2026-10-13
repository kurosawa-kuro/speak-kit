# 設定画面を作る（第一弾: AI を使うか使わないか）

## Weight Class

- Class: Medium
- Reason: 画面を 1 つ足し、AI の可否の判定を「キーの有無」から「設定とキーの有無」に変える。判定はほぼ全機能が通る（`aiEnabled()` の呼び出し元 10 ファイル）。設定を保存する表を `speak_kit` に足す。
- Limits: live DB、Supabase への SQL、Vercel、secret のコミットは 0。
- Owner approval required: yes。2026-10-13 に owner が実装を指示した（「実装依頼」）。

## Goal

利用者が画面から「AI を使う／使わない」を選べるようにする。使わないを選んだら、キーが設定されていても Anthropic へ一度も接続しない。あわせて、今後の設定画面で扱う項目の候補を一覧にし、どれから入れるかを owner が選べる状態にする。

## Context

- 方針の変更（2026-10-13 owner）: これまでは参照元（`private-ops/apps/skill-trainer`）を「限りなくコピーする」方針だった。今後は参照元から改良していく。設定画面は参照元に無い、最初の改良である。
- 今の AI の判定は `src/lib/ai/isEnabled.mjs` の 1 か所だけで、`ANTHROPIC_API_KEY` が空でなければ true になる。利用者が選ぶ手段は無い。
- `aiEnabled()` を呼んでいるのは `src/lib/ai/client.mjs`、`src/lib/ai/grade.mjs`、`src/lib/ai/features.mjs`、`src/lib/talk.mjs`、`src/lib/practice.mjs`、`src/lib/plan.mjs`、`src/lib/gate.mjs`、`src/lib/confusion.mjs`、`src/lib/dispatch.mjs`、`src/app/api/ai/status/route.js`。画面は、練習と会話が RPC の応答の `aiAvailable` で（`src/app/screens/train.js`、`src/app/screens/talk.js`）、AI 補助のパネルが `/api/ai/status` で（`src/app/ai/panel.js`）状態を受け取る。
- `aiEnabled()` は同期関数で、環境変数しか見ない。設定を DB から読むと非同期になり、呼び出し元をすべて `await` に直す必要がある。
- 画面のタブは `src/app/shell.js` の `TABS`（今日・練習・会話・記録）で決まる。設定のタブは無い。
- 学習の調整値は `skill_trainer.learning_policy_versions` の active な行（`phase1-adaptive-v2`）の `config` にある。内容は `planner_budget {Train:2, Verify:1, Measure:2}`、`dose 1`、`target_success_rate 0.8`、`target_p50_latency_ms 3000`、`evidence_window_days 30`、`min_graded_count 3`、`retention_days [1,7,30]`、`output_style POLITE_NEUTRAL`。版で管理されていて、計画・診断の行が版を記録している。
- コードに固定されている値もある。クイズの安定判定の間隔 `SPACING = 3`（`src/lib/quiz.mjs`）、混同の確認間隔 1・3・7 日（`src/lib/confusion.mjs`）、日本時間 +9 時間と週の始まりの月曜（`src/lib/plan.mjs`）、AI のタイムアウト 20 秒と 45 秒、モデル `ANTHROPIC_MODEL || "claude-sonnet-5"`（`src/lib/ai/client.mjs`）。
- 利用者は一人（`learner_key = 'default'`）。ログインは無い。
- 2026-10-13 に、コードは `src/` の下へ移した（`05_done/2026-10-13-move-code-under-src.md`）。このファイルのパスは移動後の表記である。

## Scope（第一弾: AI を使うか使わないか）

1. 設定を保存する表を足す。新しい migration `sql/postgres/<日時>_speak_kit_learner_settings.sql` で `skill_trainer.learner_settings`（`learner_key` を主キー、`ai_enabled boolean`、`updated_at`）を作り、`default` の行を入れる。参照元の 28 本は書き換えない。
2. AI の判定を 2 段に分ける。
   - `hasAnthropicKey()`: キーの有無。今の `aiEnabled()` の中身。
   - `aiEnabled()`: 設定が「使う」で、かつキーがあるときだけ true。設定は DB から読む。
   - `askClaude` は、送信の直前に必ず `aiEnabled()` を確かめる。設定が「使わない」なら `unavailable()` を返し、`fetch` を呼ばない。
3. `aiEnabled()` の呼び出し元 10 ファイルを `await` に直す。設定が「使わない」ときの挙動は、今のキー無しのときと同じにする（採点は AI 無しの経路、会話は固定の応答、候補抽出は `pending_retry`、混同ペアの下書きは使えない）。
4. 状態の API を広げる。`GET /api/ai/status` は `{ aiEnabled, keyConfigured, setting }` を返す。キーの値は返さない。
5. 設定を変える API を足す。`POST /api/settings` で `ai_enabled` を受け、保存後の状態を返す。コア機能の経路（`src/app/api/[name]/route.js`、`src/lib/dispatch.mjs`、`src/lib/plan.mjs`、`src/lib/quiz.mjs`）は AI クライアントを import しないまま保つ。
6. 設定画面を作る。`src/app/shell.js` の `TABS` に「設定」を足し、`src/app/screens/settings.js` を置く。
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
| 15 | クイズで「覚えた」とみなす条件（間を空けて 2 回正解、間隔 3 問） | `src/lib/quiz.mjs` の `SPACING = 3` | 後回し |
| 16 | 混同の確認問題の間隔 | 1・3・7 日（`src/lib/confusion.mjs`） | 後回し |
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
| 21 | タイムゾーン | 日本時間 +9 時間で固定（`src/lib/plan.mjs`） | 配布前に必要。日本以外の利用者で「今日」がずれる |
| 22 | 週の始まり | 月曜で固定 | 21 と一緒に |
| 23 | 画面の明暗 | 暗い配色だけ | 後回し |
| 24 | 音声（`env/config.yaml` の `audioEnabled: false`） | 未実装 | 音声を実装するときに |

### データ

| # | 項目 | 今の決まり方 | 提案 |
|---|---|---|---|
| 25 | 覚えたものを再チェック（`review_resets`） | 記録の画面にある | 設定へ移すか owner 判断 |
| 26 | 言えなかった表現の候補の承認／却下 | 会話の終了画面にある（参照元には無い） | 設定か記録に置き場を作る候補。`05_done/2026-10-13-close-remaining-original-gaps.md` の 34 と同じ論点 |
| 27 | 学習記録の書き出し | 無い | 配布前に検討 |
| 28 | 学習記録の全消去 | 無い | 取り消せない操作。owner 判断 |

### 起動時の設定（画面では変えず、表示だけ）

次の 2 つは設定として扱う。ただし、画面から切り替える設定ではない。起動するときに環境変数か `env/config.yaml` で決める。設定画面には「今どちらで動いているか」を読み取り専用で出す。

画面で切り替えない理由:

- ログインの有効／無効を画面で切り替えられると、ログインしていない人が画面から認証そのものを切れてしまう。
- どの DB を使うかは、DB の中に保存できない。設定の保存先（`learner_settings`）がその DB だからである。

| # | 項目 | 今の決まり方 | 提案 |
|---|---|---|---|
| 29 | ログイン機能を有効にするか | ログイン機能そのものが無い（利用者は一人、`learner_key = 'default'`） | ログインを作るときに、起動時の設定 `AUTH_ENABLED`（既定 false）で切り替える。false ならログイン画面を出さず `default` の学習者で動く。設定画面には「ログイン: 無効（一人で使用）／有効（ログイン中: ○○）」と出す |
| 30 | ローカル DB か Supabase か | 環境変数 `SPEAK_KIT_DATABASE_URL`（既定はローカルの `speak_kit`）。`src/lib/db.mjs` が DB 名 `speak_kit` 以外を拒否するため、Supabase（DB 名 `postgres`）には今はつながらない | 起動時の設定 `DATA_BACKEND=local｜supabase` を足し、`db.mjs` の検査を接続先ごとに分ける。Supabase は 29 のログインと一緒に使う前提にする。設定画面には「保存先: ローカル DB（speak_kit）／Supabase（プロジェクト名）」と出し、接続文字列とパスワードは出さない |

29 と 30 は、ログインと Supabase を作るときの別タスクで実装する。このタスクでは、設定画面に表示の枠だけを作るかを owner が決める。

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

1. 着手前に `git status` を見る。未コミットの変更があれば、衝突しないようにする。
2. migration を書き、`speak_kit` に適用する。`scripts/apply-local-schema.sh` は使わず、新しい 1 本だけ `psql -d speak_kit --single-transaction -f` で流す。
3. `src/lib/settings.mjs` と `src/lib/ai/isEnabled.mjs` を書き、呼び出し元を `await` に直す。
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
- `src/test/ai-isolation.test.mjs` を含め、`npm test` が全件通る。

## Owner-only Decisions

- `03_active/` へ移す承認
- AI の既定値。提案は「今と同じ（キーがあれば使う）」。配布版の既定を「使わない」にする案もある。
- 設定項目の候補 3〜28 から、次に入れるもの。提案は 7・8（今日の量）、17（練習の既定）、19（既定の会話相手）、21・22（タイムゾーン）。
- `src/` への移動タスクとの順序
- 29（ログインの有効／無効）と 30（ローカル DB か Supabase か）を起動時の設定とし、画面では表示だけにする方針でよいか。第一弾で表示の枠だけ作るか

実装時の扱い（2026-10-13。owner は「実装依頼」で指示し、個別の決定は出していないので、提案どおりにした）:

- AI の既定は今と同じ（キーがあれば使う）。`learner_settings.ai_enabled` の既定は true。
- 29（ログイン）と 30（保存先）は、設定画面に読み取り専用の表示の枠だけを作った。「ログイン: 無効（一人で使用）」「保存先: ローカル DB（speak_kit）」。切り替えは作っていない。
- 次に入れる設定項目（3〜28）は未決のまま。

## Stop / Ask Owner If

- 書き込み先が `speak_kit` 以外である
- `aiEnabled()` を非同期にすると、コア機能の経路（choice）が DB の読み込みを 1 回余分に待つ。体感で遅くなるなら、プロセス内のキャッシュを入れるか相談する
- 参照元の 28 本の migration を書き換えないと実現できない

## Evidence Required

- `learner_settings` の行（オン／オフの切り替え前後）
- オフ時に `fetch` が 0 回であることを示すテストの出力
- 設定画面と、各画面の理由別の表示
- `npm test` の出力

## Evidence

2026-10-13 に観測した。

### 作ったもの

- **設定を保存する表**: `sql/postgres/20261013090000_speak_kit_learner_settings.sql` を書いた。本物の `speak_kit` へは、この 1 本だけを `psql --single-transaction -f` で流した。`scripts/apply-local-schema.sh` はファイル名順に全部流すので、新しく作る DB にもこの表が入る。
- **AI 判定**: `src/lib/ai/isEnabled.mjs` に次の 4 つを置いた。
  - `hasAnthropicKey()`: キーの有無。
  - `aiStatus()`: `{ aiEnabled, keyConfigured, setting, reason }` を返す。
  - `aiAvailability()`: 画面への応答用の `{ aiAvailable, aiReason }`。
  - `aiEnabled()`: キーが無ければ DB を読まずに false を返す。
- **送信の直前の確認**: `src/lib/ai/client.mjs` の `aiGate()` で行う。`askClaude`、会話・添削・場面作り、AI 採点（`grade.mjs`）、混同ペアの下書き（`confusion.mjs`）は、すべてここを通る。
- **呼び出し元**: 文書の Context には 10 ファイルとあったが、着手時に `aiEnabled()` を呼んでいたのは 8 ファイルだった。すべて `await` に直した。今日の計画、練習、会話の応答には、`aiAvailable` に加えて `aiReason`（`setting_off` / `key_missing`）が入る。
- **API**:
  - `GET /api/ai/status`: `{ aiEnabled, keyConfigured, setting, reason }` を返す。
  - `GET /api/settings`: 設定、AI の状態、起動時の設定を返す。
  - `POST /api/settings`: `ai_enabled` が true / false 以外なら 400 を返す。
- **画面**:
  - 「設定」タブを足した（`src/app/screens/settings.js`、`src/app/shell.js`）。
  - 練習と会話の注意書きの先頭は、理由別に「設定で AI をオフにしています。」か「API キーが未設定です。」になる。どちらも `src/app/ui/labels.js` の `aiReasonLabel` を使う。

### 本物の `speak_kit` と画面サーバー（3000 番）

```text
learner_settings 前: default|t|2026-10-13 18:46:17
POST /api/settings {"ai_enabled":false}
  → {"settings":{"aiEnabled":false,…},"ai":{"aiEnabled":false,"keyConfigured":true,"reason":"setting_off"},"startup":{"login":"disabled","database":{"kind":"local","name":"speak_kit","host":"localhost"}}}
learner_settings 後: default|f|2026-10-13 18:48:09
GET /api/ai/status → {"aiEnabled":false,"keyConfigured":true,"setting":false,"reason":"setting_off"}
POST /api/settings {"ai_enabled":"no"} → validation_error
今日の計画 → aiAvailable false, aiReason setting_off
/api/ai/status の応答に "sk-ant" は 0 件
```

- **オフのとき**:
  - 設定画面は「オフ」「API キー: 設定済み」「いまの状態: 設定で AI をオフにしています。」と、使えなくなる 4 つを表示した。起動時の設定は「ログイン: 無効（一人で使用）」「保存先: ローカル DB（speak_kit）」。
  - 練習のタブへ移って戻っても、オフのままだった。
  - 練習画面の注意書きは「設定で AI をオフにしています。決定論的に正解と一致する回答は…」だった。
- **オンに戻したとき**:
  - 設定画面のスイッチでオンに戻すと、表の値は `default|t|2026-10-13 18:48:49` になり、状態は `{"aiEnabled":true,…,"reason":null}`、画面は「オン」「AI を使っています」になった。
  - `/api/ai/feedback` を 1 回呼ぶと、Anthropic が添削を返した（`"rewrite":"I went to school yesterday."`）。
- **学習記録**: 確認の後も `training_attempts` 65、`quiz_attempts` 31、`conversation_sessions` 12 で、増えていない。会話画面での表示は、会話の記録を増やさないよう本物の DB では開かず、下のテスト（応答の `aiReason`）で確かめた。

### テスト

本物の DB を写した練習用 DB（ポート 5544、試験後に削除）にキー無しで向けて `npm test` を流し、21 件中 21 件が通った。新しい `src/test/settings.test.mjs` の 4 件は次を確かめる。

- **設定オフ・キーあり**: 練習の文字回答（AI 採点まで進む）、会話の開始・送信・終了（候補の抽出を含む）、混同ペアの登録（下書き）、会話・添削・場面作りを通しても、Anthropic への `fetch` は 0 回。応答の `aiReason` は `setting_off` で、混同ペアの登録は「違いを作れませんでした: 設定で AI をオフにしています」で止まる。
- **設定オン・キー無し**: 同じ操作で `fetch` は 0 回。理由は `key_missing`、メッセージは「API キーが未設定です」。
- **設定オン・キーあり**: 添削で `fetch` が 1 回呼ばれる（数える仕組みが働いている確認。応答は差し替えた 500）。
- **選択式の流れ**: 設定オフ、キー無しのどちらでも、今日の計画 → クイズ → 回答 → 記録が通り、`fetch` は 0 回。

コアのファイル（`quiz.mjs`、`plan.mjs`、`dispatch.mjs`、`app/api/[name]/route.js`）が AI クライアントを読まない検査も通った。`next build` も通り、`/api/settings` が動的なルートとして出た。

### 作業中に起きたこと

`next build` は、動いている画面サーバーと同じ作業用フォルダ `.next` に書き込む。build のあと 3000 番が 500 を返したので、すべて止めて `.next` を消し、前と同じ設定（Anthropic キーだけを渡し、本物の DB）で立て直した。画面 200、`/api/ai/status` は `{"aiEnabled":true,"keyConfigured":true,"setting":true,"reason":null}`。画面サーバーを動かしている間は `next build` を流さない。
