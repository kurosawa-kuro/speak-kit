# コードリファクタリング案（DB の作り直しを先に行う）

## 依頼

> 揃ってきたのでコードリファクタリング依頼。設計アーキテクトレベルで `/Users/kurosawa/Dev/speak-kit/src`。必要なら DB も先に再設計リファクタリング依頼。まず、しらべて書き出し。

## Weight Class

- Class: Heavy
- Reason: DB の構成を作り直し、サーバーと画面の層の分け方を変える。全 RPC と全画面に触れる。
- Limits: live DB、Supabase への SQL、Vercel、secret のコミットは 0。書き込み先は `speak_kit` だけ。
- Owner approval required: yes。段階ごとに `03_active/` へ移す指示を受けてから着手する。

## 結論

- **DB を先に作り直す。** 理由は 2 つある。
  - YAML 管理（`05_done/2026-10-13-content-yaml-in-data.md`。2026-10-13 完了）の前提が、今の DB では崩れる。
    - 混同ペアの表は、教材の欄と学習状態の欄が同じ行に入っている。
    - アプリが混同ペアの `source` を `catalog` から書き換える。because / that's why のペアは既に書き換わり、同期の対象から外れている。
  - 学習記録は 2026-10-13 13:28〜17:39 の試用分だけである。今なら捨てて作り直せる。
- **次にサーバーを 4 層に分ける。** 入口・検証、業務処理、SQL、AI の 4 つにする。
  - いちばん重い問題は、AI の応答（最大 45 秒）を DB のトランザクションとロックを持ったまま待っていること（`lib/talk.mjs`）。
  - その次は、記述回答の採点の書き込み 10 本前後がトランザクションに入っていないこと（`lib/attempt.mjs`）。途中で失敗したときは、後から修復するコードで帳尻を合わせている。
- **画面は Next.js の実ルートにする。** 今は `useState` の自前ルーターで、URL と連動しない。リロードや「戻る」で画面が消える。
- **すぐ直すべきバグが 10 件ある**（第 1 段）。
- **追加された設定画面は、機能としては正しく動く。** ただし、構造の問題が 3 つある（問題点 E）。設定だけ RPC と別の API の形になっていること、AI の可否を 1 つの操作の中で何度も DB から読むこと、起動時の設定を二重に定義していることである。第 3 段で RPC にまとめる。

## 調査の範囲と方法

- `src/lib` 21 ファイル、`src/app` 21 ファイル（約 6,600 行）をすべて読んだ。
- `speak_kit.skill_trainer` は読み取りだけで調べた。27 表、2 ビュー、13 関数、19 トリガー。`sql/postgres/` の 28 本も読んだ。
- 重い指摘（候補のキー名の不一致、会話の再開、トランザクション内の AI 呼び出し、使われていないファイル）は、実物で行番号を確かめた。
- 行番号は 2026-10-13 18 時台のもの。作業中の `src/lib/content/` と `src/cli/` は評価から外した。

## 現状の構造

```text
画面 (src/app, すべて "use client")
  shell.js の useState で 今日 / 練習 / 会話 / 記録 を切り替え（URL と連動しない）
  ui/use-rpc.js → POST /api/<rpc名>
        │
src/app/api/[name]/route.js → lib/dispatch.mjs（16 RPC の振り分け＋検証＋一部の業務 SQL）
        │
lib/attempt (707行)  plan (503)  quiz (516)  talk (547)  planner  practice  confusion
    boundary  learning  gate  candidates
        │  ← 各ファイルが検証・業務ルール・SQL・AI 呼び出しを同じ関数に持つ
lib/db.mjs（pool）   lib/ai/client.mjs（fetch 直呼び）
        │
Postgres speak_kit.skill_trainer（27 表、トリガーで暗黙に行を作る）
```

## 問題点

### A. すぐ直すべきバグ（構造の変更とは独立して直せる）

| # | 場所 | 内容 |
|---|---|---|
| A1 | `app/screens/talk.js:37-38` | 会話の「もう一度話す」が `session_id` を作り直さない。同じ相手を選ぶと終了済みの会話が再生され、送信は `session_ended` で失敗する。別の相手を選ぶと `idempotency_conflict` になる |
| A2 | `app/screens/talk.js:200` | 日本語入力の変換を確定する Enter で送信される（`isComposing` を見ていない） |
| A3 | `lib/talk.mjs:122` | プロンプトは `existingCandidateId` を返させるのに、読む側は `existing_candidate_id` を見ている。「既存の候補と同じか」の判定が一度も効かない |
| A4 | `lib/talk.mjs:315` | 会話での使用を判定する SQL の正規化が、`normalizeAnswer` と違う。短縮形やカンマのある例文が一致せず、会話での使用の記録が付かない |
| A5 | `lib/confusion.mjs:119` | `submissionId` に `pairId` を入れて返している |
| A6 | `lib/attempt.mjs:599` | 再判定で、同じ依頼の再送かを確かめる前に AI を呼ぶ。再送のたびに課金される。同時に来ると一意制約違反で 500 になる |
| A7 | `lib/practice.mjs:129` | 練習の取得の冪等キーに `skill_key` が入っていない。再送時に、別の表現の問題文と古い問題 ID が組み合わさって返る |
| A8 | `app/screens/train.js:105-110, 188-189` | 確認問題に答えた直後、古い計画データから同じ確認問題がもう一度出る |
| A9 | `app/screens/train.js`、`quiz.js`、`records.js` | エラーが出ても成功扱いで進む箇所と、再試行してもエラー表示が消えない箇所がある（混同ペアの登録、再チェック、回答送信） |
| A10 | `lib/candidates.mjs:103` | 候補から作るすべての問題に、採点契約 `adaptive:REQ-001` を流用している |

### B. サーバー（`src/lib`）の構造

1. **トランザクション内で AI を待つ**
   - `talk.mjs` の `sendTalkMessage`（211〜388 行）と `endTalkSession`（431〜547 行）は、ロックを取ったトランザクションの中で AI を最大 45 秒待つ。
   - そのトランザクションの中で、`loadPolicy()` が別の接続を取る。同時に操作されると接続が尽きる。
2. **書き込みがトランザクションに入っていない**
   - `attempt.mjs` の記述回答の採点（358〜388 行）は、回答・採点・証拠・計画・診断・混同の書き込みが 1 本ずつ確定する。
   - 途中で失敗した分は、修復処理（279〜335 行）で補っている。
   - 同じ形の問題: 混同ペアの登録と確認問題の採点（`confusion.mjs`）、候補の承認（`candidates.mjs`）、会話の開始（`talk.mjs`）、再チェック（`dispatch.mjs:99-114`）。
3. **層が混ざっている**
   - 100 行を超える関数が 12 個あり、どれも入力の検証・業務ルール・SQL・応答の整形を 1 つの関数に持つ。
   - 最大は `sendTalkMessage` の 183 行、次が `createAdaptivePlan` の 145 行。
   - 振り分け役の `dispatch.mjs` に、再チェックの UPDATE が直接書かれている。
4. **読み取りのはずの RPC が書き込む**
   - `get_today_plan` は計画を作り、問題を skipped にする。
   - `get_practice` は確認問題の配信記録を書く。
   - 画面の開発モード（StrictMode）では、これらが 2 回走る。
5. **同じものの重複**
   - 入力の取り出し `text()` が 5 個、UUID の判定が 5 個、回答時間の範囲チェックが 3 個ある。
   - SQL の重複:
     - 再チェックの基準時刻（`review_resets`）を作る式が 5 か所
     - 「覚えた」の判定が 3 か所
     - 推定値の集計が 5 か所
   - 採点結果の INSERT が 6 か所、証拠の INSERT が 4 か所に散らばっている。
   - 会話相手の役割の文（`talk.mjs` と `ai/prompts.mjs`）、`{slot}` を `...` に置き換える処理 3 種、AI の応答から JSON を取り出す処理 4 種も重複している。
6. **固定値が散っている**
   - `learner_key = 'default'` が 32 か所、`'english_conversation'` が 6 ファイルにある。
   - 日本時間は `+9 時間` の計算と `'Asia/Tokyo'` が混在している。
   - その他: AI のモデル名・タイムアウト・トークン上限、クイズの間隔、混同の確認間隔、記録の画面の閾値。
7. **エラーの返し方が 3 通りある**
   - 正式な envelope、AI 系の `{ok, code}`、ルートの 404。
   - 例外を envelope に変換しないので、500 になり、画面には空のメッセージが出る。
   - `replayed` は常に false で、再送かどうかは `code` で表している。
8. **使われていないコード**
   - `src/app/ai/panel.js` と `boundary.js` はどこからも描画されていない。
   - そのため `/api/ai/talk`、`/feedback`、`/scenario`、`/grade` と `lib/ai/features.mjs` は、画面から一度も呼ばれない。
   - `/api/ai/status` も、呼んでいるのは描画されない `panel.js` だけである。
   - 使われていない export: `quiz.mjs` の `sha256`、`boundary.mjs` の `boundaryCrossed` と `pairJson`、`learning.mjs` の `refreshDiagnosis`。
9. **テストしにくい**
   - 診断のルール（`deriveWeakness`）、合否の判定（`requirementPasses`）、週の重点の決め方など、純粋な関数が export されていない。
   - DB なしでは試せない。AI は `fetch` を直接呼ぶので、差し替えにくい。

### C. 画面（`src/app`）の構造

1. **URL と連動しない自前のルーター**
   - `shell.js` の `useState` で画面を切り替えている。リロード・戻る・リンクの共有が効かない。
   - 画面を切り替えるたびに作り直す（`key`）ので、会話中にタブを押すと、サーバーで会話を終えないまま消える。
2. **画面の関数が大きすぎる**
   - `Train` 430 行、`Records` 316 行、`Talk` 295 行、`QuickQuiz` 235 行、`Today` 190 行。
   - `Train` は、計画モード、自由練習、採点待ちの 2 秒ごとの問い合わせ、確認問題の状態、混同ペアの登録フォームを 1 つの関数に持つ。
3. **部品のコピー**
   - スピナー 5 か所、エラー表示と再試行 4 か所、`uuid()` 3 個、混同ペアの違いの表示 4 か所、指標の箱 3 種類。
   - 会話相手の一覧が 3 か所（`talk.js`、`panel.js`、`dispatch.mjs`）にあり、文言も違う。
4. **業務の判断が画面にある**
   - 採点結果の見出しと再判定ボタンを出すかどうか。
   - 候補を承認するときの `stable_key: FREEZE_<id>` と `category: OUTPUT`。
   - 「見れば分かるが自力では出ない」の閾値（90%、80%）。
   - クイズの正解を、ID ではなく文字列の一致で判定している。
5. **RPC の呼び出しフック（`useRpc`）**
   - 失敗すると `null` を返すが、呼ぶ側が確かめていない。
   - エラーを消す手段がない。
   - HTTP のステータスを見ていない。

### D. DB（`speak_kit.skill_trainer`）

1. **教材と学習状態が同じ行にある**
   - `confusion_pairs`: 説明の欄と、回数・連続正解・次の出題日。
   - `confusion_probes.last_served_at` も同じ問題を持つ。
   - アプリが `source` を書き換えるので、YAML 同期の対象から行が抜ける。
2. **「問題」の表が 6 つ、「回答」の表が 5 つある**
   - 問題: `exercise_definitions`、`rendered_exercises`、`exercises`、`quiz_items`、`confusion_probes`、`assessment_contracts`。
     - `exercises` は、記述では出題 1 回ごと、クイズと確認問題では教材 1 件ごとの行で、粒度が揃っていない。
   - 回答: `training_attempts`、`attempt_responses`、`quiz_attempts`、`confusion_events`、`conversation_turns`。
3. **採点契約が問題ごとに複製されている**
   - `assessment_contracts` 326 行のうち 324 行は、問題ごとの複製である。中身は採点の版の数種類しかない。
4. **使われていないもの**
   - `learning_policy`（v1 の残り）。
   - `attempt_responses`: トリガーで `training_attempts` と同じ内容を書くだけで、誰も読まない。
   - ビュー `evaluations`、`conversation_turns` の判定 5 列。
5. **学習者の区別が中途半端**
   - 回答・採点・証拠の中心の 3 表に `learner_key` が無い。
   - 学習者の表も無い。
6. **制約と索引が足りない**
   - 能力名（`CONTROLLED_RECALL` など）の一覧表と CHECK が無い。
   - 混同ペアは `skill_key_a/b` で表現を文字列で指しているだけで、FK が無い。
   - よく通る経路の索引が無い: `training_attempts` の `exercise_id` と `occurred_at`、`capability_evidence.training_attempt_id` など 28 か所。
7. **トリガーへの暗黙の依存**
   - クイズと確認問題の `exercises` の行は、トリガーでしか作られない。
   - 確認問題の文を UPSERT で書き換えても、`exercises` の文は古いままになる。
8. **migration の管理が無い**
   - 適用済みの記録が無く、28 本を毎回全部流す。
   - 22 本目で、再適用が失敗する。
   - 空の DB には、手で role などを作らないと乗らない。
   - seed の SQL（約 1,500 行）が教材を持っていて、YAML と二重管理になる。

### E. 設定画面（2026-10-13 追加分の再調査）

対象: 次の 8 ファイル（コミット `4934163` 時点）。

- `sql/postgres/20261013090000_speak_kit_learner_settings.sql`
- `src/lib/settings.mjs`
- `src/lib/ai/isEnabled.mjs`
- `src/lib/ai/client.mjs`
- `src/app/api/settings/route.js`
- `src/app/api/ai/status/route.js`
- `src/app/screens/settings.js`
- `src/test/settings.test.mjs`

**できていること:**

- AI を使えるかの判定を `aiStatus()` の 1 か所に集め、設定とキーの有無から決めている。
- `askClaude` は送信の直前に必ず `aiGate()` を通る。設定がオフなら、キーがあっても Anthropic へ接続しない（テストで確かめている）。
- 画面とサーバーが「設定でオフ」と「キー未設定」を言い分けている。
- キーの値は応答に含めない。
- ログインと保存先は、画面では変えずに表示だけにしている。

**問題:**

1. **AI の可否を、毎回 DB から読んでいる**
   - `aiStatus()` は呼ばれるたびに `learner_settings` を SELECT する。
   - 1 つの操作の中で何度も呼ばれる。
     - `getPractice` で 2 回（`practice.mjs:71, 178`）
     - 会話の送信で、応答用（`talk.mjs:256, 385`）と AI 呼び出しの前（`aiGate`）
     - `askClaude` を呼ぶたびに 1 回
   - 判定の入口も 4 つある（`aiStatus`、`aiAvailability`、`aiEnabled`、`aiGate`）。キーの有無の確認が `aiEnabled` と `aiGate` で重複している。
2. **トランザクションの中から別の接続で設定を読む**
   - `sendTalkMessage` と `endTalkSession` は、ロックを取ったトランザクションの中で `aiAvailability()` と `askClaude()` を呼ぶ。
   - その中の `getSettings()` は、トランザクションの `client` ではなく、プールの別の接続を使う。
   - B1 の「トランザクション内で AI を待つ」問題に、接続をもう 1 本使う問題が加わった。
3. **設定だけ API の形が違う**
   - `/api/settings` は、16 RPC の `/api/[name]` → `dispatch` の外にある別のルートである。
   - 応答に `api_version` が無く、検証の誤りは HTTP 400 を返す。ほかの RPC は 200 を返す。
   - 画面側も `useRpc` を使わず、`settings.js` が自前の `fetch` を持つ。データ取得の経路が 4 つ目になった（`ui/rpc.js`、`ui/use-rpc.js`、`ai/panel.js`、`screens/settings.js`）。
4. **起動時の設定が二重に定義されている**
   - `startupSettings()`（`settings.mjs:17-23`）は、接続先の URL を `db.mjs` とは別に組み立て直している。既定の URL（ユーザー名 `kurosawa` 入り）も重複している。
   - `login: "disabled"` と `kind: "local"` は固定の値で、実際の起動設定を読んでいない。
5. **固定値がまた増えた**
   - `const LEARNER = "default"`（`settings.mjs:3`）。
   - AI を使う機能の一覧 `AI_FEATURES`（`settings.js:6`）が画面に直書きされている。実際に AI を使う箇所（採点、会話、候補抽出、混同ペアの下書き）とずれても気づけない。
6. **文言の対応表が 2 つある**
   - 理由の文言が、サーバーの `AI_REASON_MESSAGES`（`isEnabled.mjs:3-6`）と、画面の `aiReasonLabel`（`labels.js:109-113`）の 2 か所にある。句点の有無も違う。
7. **設定の表の置き場**
   - `learner_settings` は参照元の `skill_trainer` スキーマに、参照元の 28 本に続く 29 本目として足された。
   - `learner_key` は FK の無い文字列である。既定値が `ai_enabled = true` になっている。
   - 列を足すたびに migration が要る。今後の設定項目（今日の量、既定の会話相手、タイムゾーンなど）を列で増やすか、キーと値で持つかを決める必要がある。
8. **テストが本物の設定を切り替える**
   - `settings.test.mjs` は、本物の `speak_kit` の `ai_enabled` をオフ・オンにし、終わったら元に戻す。
   - テストの間（約 1 秒）は、動いているアプリでも AI がオフになる。テストが途中で止まると、オフのまま残る。
   - 本物の学習記録にも、回答と会話を書き込む（`実運用可能な状況かをレビュー依頼.md` の R2）。
9. **認証が無いまま設定を変えられる**
   - `POST /api/settings` は誰でも呼べる。開発サーバーは LAN に開いている（同レビューの R3）。
   - 同じ Wi-Fi の誰でも、AI のオン・オフを切り替えられる。
10. **`/api/ai/status` は、もう画面から使われていない**
    - 設定画面は `/api/settings` を使う。各画面は RPC の応答の `aiAvailable` / `aiReason` を使う。
    - 呼んでいるのは、どこからも描画されない `app/ai/panel.js` だけである。

## 目標の形

### サーバーの層

```text
src/app/api/[name]/route.js     入口。JSON を読み、handler を呼び、例外も envelope にして返す
src/server/handlers/<rpc>.mjs   1 RPC = 1 ファイル。入力の検証と応答の整形だけ
src/server/services/            業務処理。トランザクションの境界を持つ。AI はトランザクションの外で呼ぶ
  attempt / quiz / plan / talk / confusion / candidates / progress / gate
src/server/domain/              純粋な関数。DB も AI も使わない。単体テストの中心
  estimate（推定値・信頼度）、diagnosis（弱点の診断）、spacing（出題間隔）、
  normalize（回答の正規化・{slot} の表示）、boundary（混同の目印）
src/server/repo/                SQL だけ。client を引数で受け、どのトランザクションにも乗れる
  attempts / observations / evidence / plans / content / confusion / talk
src/server/ai/                  AI の窓口。fetch を差し替えられる。プロンプトは prompts.mjs の 1 か所
src/server/config.mjs           起動時の設定（learner_key、ドメイン、タイムゾーン、DB の接続先、ログインの有無、AI のモデル・タイムアウト、閾値）。
                                環境変数を読むのはここだけ。設定画面の「起動時の設定」はここから表示する
src/server/services/settings    画面から変える設定。1 回の操作の最初に 1 度だけ読み、AI の可否と一緒に
                                「操作の文脈」（learner、設定、aiAvailable / aiReason）として各 service に渡す
src/server/http/                validate（text・uuid・回答時間）、envelope、エラーの型
```

決まりごと:

- **AI の呼び出しは「AI → 短いトランザクションで書き込み」の 2 段階にする。** ロックを持ったまま外部を待たない。
- **1 つの操作の書き込みは、1 つのトランザクションに入れる。** 修復処理（`repairAttemptSideEffects` など）は要らなくなるので消す。
- **再送の確認は、ロックかトランザクションの中で行う。** 一意制約にぶつかったら、再送として扱う。
- **読み取りの RPC は書き込まない。** 計画を作るのは「今日の計画を作る」操作に分ける。
- **エラーは 1 つの envelope にそろえる。** 検証の誤りは 400、見つからないは 404、想定外は 500 で返す。画面向けの日本語の文言は、`code` から画面側で決める。
- **AI の可否は、1 回の操作で 1 度だけ決める。**
  - 操作の最初に、設定とキーの有無から `aiAvailable` / `aiReason` を決め、文脈として渡す。
  - AI の窓口（`server/ai`）は、その文脈を受け取って送るか止めるかを決める。DB は読まない。
  - 判定の入口は 1 つにする（今の `aiStatus`・`aiAvailability`・`aiEnabled`・`aiGate` をまとめる）。
- **設定も RPC の 1 つにする。** `skill_trainer_get_settings` と `skill_trainer_save_settings` を `dispatch` に足し、ほかの RPC と同じ envelope と `useRpc` で扱う。`/api/settings` と `/api/ai/status` は消す。
- **理由などの文言は画面側の 1 か所に置く。** サーバーは `code`（`setting_off` / `key_missing`）だけを返す。
- **AI を使う機能の一覧はサーバーが持つ。** 設定画面の「オフにすると使えないもの」は、その一覧から表示する。

### 画面の形

```text
src/app/(main)/today/page.js       今日
src/app/(main)/train/page.js       練習（?plan=today、?skill=...）
src/app/(main)/talk/page.js        会話
src/app/(main)/records/page.js     記録
src/app/(main)/settings/page.js    設定（設定画面のタスク）
src/app/(main)/layout.js           ヘッダーとタブ（next/link）
src/app/_components/               Card, Metric, Spinner, ErrorCard, AiUnavailableBanner, BoundaryPair, ToggleButton
src/app/_hooks/                    useRpc（成否を型で返す、エラーを消せる）, useGradePoller, useConfusionProbe
src/app/_lib/                      labels, format（秒・%・分の整形を 1 か所に）, uuid
```

- `Train` は、計画モード、自由練習、確認問題、採点待ちの問い合わせ、回答の履歴に分ける。
- 業務の判断（採点結果の見出し、候補の承認内容、閾値、クイズの正解 ID）はサーバーの応答に移す。

### DB の形（作り直し案）

方針:

- 教材の正本は YAML。DB の教材の行は、YAML から同期した写しにする。
- 記録は追記専用で、学習者ごとに分ける。
- 学習状態は、教材の行とは別の表に置く。

| 区分 | 表 | 変更 |
|---|---|---|
| 教材 | `domains`, `domain_categories`, `skill_concepts`, `exercise_definitions`, `quiz_items` | 残す。`skill_concepts.id` は記録が指すので変えない |
| 教材 | `confusion_pairs` | **分ける。** 教材の欄だけを残し、`learner_key` を外す。出どころ（catalog / learner / observed）は書き換えない。`skill_key_a/b` は FK にする |
| 学習状態 | `learner_confusion_state`（新） | 学習者×ペアで、回数、連続正解、待ちの側、配信中の確認問題、次の出題日を持つ。`confusion_probes.last_served_at` もここへ移す |
| 教材 | `confusion_probes` | 残す。文を変えるときは上書きせず、新しい版を足す |
| 採点 | `assessment_contracts` | 問題ごとの 324 行を、採点の版ごとの約 8 行にまとめる |
| 記録 | `training_attempts`, `grading_observations`, `capability_evidence` | 残す。`learner_key NOT NULL` を足す。索引を足す |
| 記録 | `quiz_attempts` | `training_attempt_id` を主キーにした詳細だけの表にし、重複した列を外す |
| 記録 | `confusion_events` | 「確認問題の結果」と「誤答から見つけた混同」に分ける |
| 記録 | `conversation_sessions`, `conversation_turns` | 残す。会話の判定は JSON ではなくターンの列を正にする。`learner_key` を足す |
| 計画・診断 | `training_plans`, `training_plan_items`, `weakness_diagnoses`, `rendered_exercises`, `review_resets`, `quiz_promotions` | 残す |
| 設定 | `learning_policy_versions`, `learner_phase_gate_policies` | 残す。v1 と v2 が同じ時刻にならないように `effective_at` を固定値にする |
| 設定 | `learners`（新）、`learner_settings`（2026-10-13 に追加済み） | 学習者の表を足し、`learner_settings.learner_key` から FK で指す。`learner_settings` は baseline に取り込む。今後の設定項目（今日の量、既定の会話相手、タイムゾーンなど）は、型の付いた列で足す。キーと値の汎用表にはしない。理由は、値の型と既定値を DB で守れるから |
| 一覧 | `capabilities`（新） | 能力名の一覧。各表の能力の列から FK で指す |
| 削除 | `learning_policy`, `attempt_responses`（とトリガー）, ビュー `evaluations` | 使われていない |
| 管理 | `schema_migrations`（新） | 適用済みの migration を記録する |

migration の作り直し:

- 参照元からコピーした 28 本は `sql/archive/` に移して保存する。
- 新しい 1 本の baseline（表・制約・索引・トリガー・関数）と、`schema_migrations` で記録しながら流す適用スクリプトに置き換える。
- 教材の seed は SQL に持たない。YAML から `npm run data:sync -- --apply` で入れる。
- 空の DB に、手作業なしで乗ること（role の作成も baseline に含める）。

## 段階計画

各段は 1 つの task として `03_active/` に出す。段ごとに `npm test`、`npx next build`、キー無しで今日 → クイズ → 回答 → 記録の経路を確かめてから次へ進む。

### 第 1 段: バグの修正（A1〜A10）

- 構造は変えずに直す。1 件ごとにテストか画面の操作で再現し、直ったことを確かめる。
- A3（候補のキー名）と A10（採点契約の流用）は、YAML 管理の前提にも関わるので先に直す。

### 第 2 段: DB の作り直し

1. owner の判断で、試用の学習記録を捨てるか残すかを決める（Owner-only Decisions）。
2. 新しい baseline と適用スクリプトを書き、空の DB `speak_kit_next` で試す。
3. YAML 同期（`05_done/2026-10-13-content-yaml-in-data.md` の成果）で教材を入れ、件数が今と同じになることを確かめる。表現 51、練習問題 325、クイズ 257、混同ペア 34。
4. 記録を残す場合は、移す SQL を書いて件数を突き合わせる。
5. `speak_kit` を入れ替える。元の DB は `pg_dump` で保存してから入れ替える。

### 第 3 段: サーバーの層の分離

1. `config.mjs`、`http/validate.mjs`、`domain/*` を作り、純粋な関数に単体テストを付ける。
2. `repo/*` に SQL を移す。重複している SQL（再チェックの基準時刻、「覚えた」の判定、推定値の集計、採点・証拠の INSERT）は 1 つにまとめる。
3. `services/*` を 1 つずつ作り、トランザクションの境界を決める。順番は影響の大きい順:
   - talk（AI をトランザクションの外へ）
   - attempt（修復処理を消す）
   - confusion
   - quiz
   - plan・progress
   - candidates
   - gate
4. `handlers/*` と `route.js` で、エラーを 1 つの envelope にそろえる。
5. 使われていない `lib/ai/features.mjs`、`/api/ai/*`（`/api/ai/status` を含む）、`app/ai/*`、未使用の export を消す。
6. 設定を RPC にまとめる（E の 1〜6）。
   - `config.mjs` に起動時の設定を集め、`startupSettings()` と `db.mjs` の二重定義をなくす。
   - 操作の文脈で AI の可否を 1 度だけ決め、トランザクションの中で別の接続を取らないようにする。
   - `/api/settings` を `skill_trainer_get_settings` / `skill_trainer_save_settings` に置き換える。

### 第 4 段: 画面の作り直し

1. App Router の実ルートに移し、タブを `next/link` にする。
2. 共通部品とフックを作り、各画面のコピーを置き換える。
3. `Train` を分ける。
4. 業務の判断をサーバーの応答に移す（第 3 段の応答に項目を足す）。
5. 設定画面を `src/app/(main)/settings/page.js` に移し、自前の `fetch` を `useRpc` に置き換える。理由の文言は `labels` の 1 か所にする。

### 第 5 段: 仕上げ

- `README.md`、`docs/02_architecture.md`、`docs/05_data_model.md` を新しい形に書き直す。
- `CLAUDE.md` の「参照元を限りなくコピーする」方針を、「参照元を土台に改良する」に直す。

## 他のタスクとの関係

- `05_done/2026-10-13-content-yaml-in-data.md`（2026-10-13 完了）
  - 第 2 段は、この YAML 同期を教材の入れ方として使う。
  - 逆に、同期の今の作りは `confusion_pairs` を書き換える前提になっている。第 2 段の分割に合わせて直す。
- `05_done/2026-10-13-settings-screen.md`（2026-10-13 完了。今の DB に `learner_settings` を足し、画面は今のタブ「設定」で作った）
  - `learner_settings` は第 2 段の baseline に入れる。
  - 画面は第 4 段の新しいルート（`/settings`）で作る。
- `02_backlog/2026-10-13-close-remaining-original-gaps.md`
  - 参照元との差分 47 件は、「参照元から改良する」方針に変わったので、そのままは追わない。
  - 残す項目を第 3・4 段の中で選び直す。

## Non-scope

- 音声、ログイン、複数の学習者を画面で切り替えること。表に `learner_key` は持たせるが、使うのは `default` だけ。
- TypeScript への移行。必要なら第 3 段の後で別タスクにする。
- Supabase と Vercel への反映。
- 16 個の RPC 名の変更。画面と API の名前は第 3 段でも保つ。

## Risk

- 第 2 段で記録を残す場合、採点契約の統合は不変トリガー付きの 2 表（`exercises` 428 行、`exercise_definitions` 325 行）の参照を張り替える。いちばん壊れやすい。
- 第 3 段は全 RPC の応答に触れる。応答の形が変わると画面が壊れる。段の前に、RPC ごとの応答を固定したテスト（golden）を足してから始める。
- AI をトランザクションの外に出すと、「AI の応答を得たが書き込む前に別の操作が入る」場合が出る。書き込み時に状態を再確認する。

## Owner-only Decisions

- 段ごとに `03_active/` へ移す承認
- **試用の学習記録（2026-10-13 の約 4 時間分）を捨てて作り直すか、移して残すか。** 提案は「捨てる」。いちばん安全で単純になる。
- 第 1 段のバグの修正を、YAML 管理のタスクより先にするか
- 複数の学習者を見据えて `learners` 表まで作るか、`learner_key` の列だけにするか
- `lib/ai/features.mjs` と `/api/ai/*` を消すか（画面から使われていない）

## Evidence Required

- 段ごとに `npm test` と `npx next build` の出力
- 第 2 段: 新旧の DB の教材の件数の突き合わせ、空の DB に手作業なしで乗ったログ
- 第 3 段: AI を待つ間に DB のロックを持っていないこと（テストで AI の応答を遅らせ、別の操作が待たされないことを確かめる）
- 第 4 段: リロード・戻る・リンクで同じ画面が開くこと
