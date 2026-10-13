# コードリファクタリング案（DB の作り直しを先に行う）

## 依頼

> 揃ってきたのでコードリファクタリング依頼。設計アーキテクトレベルで `/Users/kurosawa/Dev/speak-kit/src`。必要なら DB も先に再設計リファクタリング依頼。まず、しらべて書き出し。

> （2026-10-13 19 時台）色々追加したので、改めてリファクタリング案を調査しドキュメントを修正依頼

## Weight Class

- Class: Heavy
- Reason: DB の構成を作り直し、サーバーと画面の層の分け方を変える。全 RPC と全画面に触れる。
- Limits: live DB、Supabase への SQL、Vercel、secret のコミットは 0。書き込み先は `speak_kit` だけ。
- Owner approval required: yes。段階ごとに `03_active/` へ移す指示を受けてから着手する。

## owner の判断（2026-10-13 19:10）

| # | 問い | 判断 | この案への反映 |
|---|---|---|---|
| O1 | 画面から登録された混同ペア 2 件（have a problem / take a problem、borrow a book / lend a book）を、教材として残すか、学習の記録として残すか | **どちらにも残さない。** borrow / lend はテスト（`golden-path.test.mjs`）が書いたもので、もう 1 件も試用中の登録である | 第 2 段で、新しい DB に移さない。`data/confusion_pairs.yaml` からも消す。画面からのペアの登録の機能は残す |
| O2 | 候補の承認から作る練習問題を、YAML の表現と同じ種類にするか、CR だけにするか | **YAML と同じにする。** 入口で種類が違うと、教材の正本（YAML）と DB が揃わず、運用できない | 第 3 段の 2。候補の承認も YAML と同じ導出の関数を通す |
| O3 | クラウドに出すのを、この案の第 2・3 段の前にするか後にするか | **後にする。クラウド化は急がない** | クラウド対応（`01_idea/クラウドインフラ対応.md`）は、この案の第 3 段の後に検討する |
| O4 | AI の利用量に上限を置くか | **置く。現実的な値で** | 第 3 段の `server/ai`。値は下の「AI の利用量の上限」 |
| O5 | 試用の学習記録を捨てるか、移すか（19:15） | **捨てる** | 第 2 段。元の DB は `pg_dump` で保存してから入れ替える |
| O6 | `learners` 表まで作るか（19:15） | **`learner_key` の列だけ** | 第 2 段。`learners` 表は作らない |
| O7 | 使われていない AI 機能（`lib/ai/features.mjs`、`/api/ai/*`、`app/ai/*`）を消すか（19:15） | **消す** | 第 3 段 |
| O8 | 着手の範囲（19:15） | **第 1〜5 段を順に、できるところまで全部** | 段ごとに `npm test`・ビルド・経路を確かめてコミットする |

### AI の利用量の上限（O4 の値）

- **1 日 2 ドル（約 300 円）、1 か月 20 ドル（約 3,000 円）。** 金額は、Anthropic の応答に付く使用トークン数（`usage`）から計算する。
- 根拠（2026-10-13 の価格表。Claude Sonnet 5 は入力 100 万トークン 2 ドル、出力 100 万トークン 10 ドル）:
  - 1 回の呼び出しは、入力 1,500〜2,500 トークン、出力 300〜1,200 トークン。おおよそ 1 回 0.5〜1.7 セント。
  - 毎日しっかり使う日の見込み: 記述の採点 30 回、会話 2 回（各 15 ターン、開始と候補の抽出を含めて約 34 回）、混同ペアの下書き 2 回で、約 66 回、0.7 ドル前後。
  - 1 日 2 ドルは、その約 3 倍。普通の使い方では止まらず、同じ操作の繰り返しや不具合による連続呼び出し（A6 の再判定など）は 1 日で止まる。
  - 1 か月 20 ドルは、しっかり使う日が 30 日続いてやっと届く量（0.7 ドル × 30 日 ≈ 21 ドル）。休む日があれば届かない。届いたら、使い方か不具合を疑う合図にする。
- 上限に達したら、AI を使えない理由 `limit_reached`（「今日（今月）の AI の利用上限に達しました」）として扱う。設定のオフ・キー未設定と同じく、コアの練習と記録は止めない。
- 使った量は DB に記録する（新しい表 `ai_usage`。日時、機能、モデル、入力・出力トークン、金額）。設定画面に、今日と今月の使用額と上限を出す。
- 上限の値とモデルごとの単価は `server/config.mjs` に置く。価格表が変わったらそこを直す。
- Anthropic のコンソールでも、組織の月の使用上限を同じくらいに設定しておくと、アプリの不具合でも二重に止まる（owner がコンソールで行う）。

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
- **すぐ直すべきバグは 9 件残っている**（第 1 段）。10 件のうち A2（日本語入力の Enter）は直した。
- **追加された設定画面は、機能としては正しく動く。** ただし、構造の問題が 3 つある（問題点 E）。設定だけ RPC と別の API の形になっていること、AI の可否を 1 つの操作の中で何度も DB から読むこと、起動時の設定を二重に定義していることである。第 3 段で RPC にまとめる。
- **教材の YAML 管理（問題点 F）は動くが、教材を DB に作る処理が 3 か所に分かれている。** YAML の同期、会話の候補の承認、混同ペアの登録である。入口によって、作られる練習問題の種類と採点契約が違う。第 2 段の DB の形に合わせて、第 3 段で 1 つにまとめる。
- **テストの DB と起動の足回り（問題点 G）は、DB の作り直しで軽くなる。** schema を流すスクリプトが 2 本あり、前提の role と表を手で作っている。DB の接続先の既定値が 5 か所に書かれている。
- **ほかの文書の要件を、この案の段に割り当てた**（「ほかの文書から来た要件」）。実運用レビューの H1〜H9 と、クラウド対応のアイディアの C1〜C5 である。クラウドに出す前に、第 2 段と第 3 段の一部（AI をトランザクションの外へ、裏の採点、起動時の設定）を済ませておくと、クラウドの作業が軽くなる。

## 調査の範囲と方法

- 初回（2026-10-13 18 時台）: `src/lib` 21 ファイル、`src/app` 21 ファイル（約 6,600 行）をすべて読んだ。`speak_kit.skill_trainer` は読み取りだけで調べた（27 表、2 ビュー、13 関数、19 トリガー）。`sql/postgres/` の 28 本も読んだ。重い指摘（候補のキー名の不一致、会話の再開、トランザクション内の AI 呼び出し、使われていないファイル）は、実物で行番号を確かめた。
- 再調査（2026-10-13 19 時台、コミット `157bbe1`）: その後に足された次のものを読み、初回の指摘が今も当てはまるかを行番号で確かめ直した。
  - 教材の YAML 管理: `src/lib/content/` 5 ファイル、`src/cli/data.mjs`
  - 設定画面: `src/lib/settings.mjs`、`src/lib/ai/isEnabled.mjs`、`src/app/screens/settings.js` ほか
  - テスト用 DB: `scripts/reset-test-db.sh`、`src/test/test-db.mjs`
  - 日本語入力の Enter: `src/app/ui/keys.js`
- 今の大きさ: `src/lib` 27 ファイル 5,408 行、`src/app` 23 ファイル 2,198 行、`src/cli` 99 行、`src/test` 8 ファイル 472 行。DB は 28 表（`learner_settings` が増えた）、2 ビュー、13 関数、19 トリガー。`sql/postgres/` は 29 本。
- 行番号は再調査の時点のもの。

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
lib/db.mjs（pool）   lib/ai/client.mjs（fetch 直呼び）   lib/settings.mjs（設定。/api/settings から）
        │
Postgres speak_kit.skill_trainer（28 表、トリガーで暗黙に行を作る）
        ▲
src/cli/data.mjs → lib/content/（YAML の検査・差分・反映・書き出し。DB に直接 SQL を書く）
scripts/apply-local-schema.sh（speak_kit 固定）  scripts/reset-test-db.sh（speak_kit_test を作り直す）
```

## 問題点

### A. すぐ直すべきバグ（構造の変更とは独立して直せる）

| # | 場所 | 内容 |
|---|---|---|
| A1 | **直した（第 1 段）** `app/screens/talk.js:39-45, 100` | 会話の「もう一度話す」（`handleRestart`）が `session_id` を作り直さない。同じ相手を選ぶと終了済みの会話が再生され、送信は `session_ended` で失敗する。別の相手を選ぶと `idempotency_conflict` になる |
| A2 | ~~`app/screens/talk.js:200`~~ | **直した**（コミット `fbcc0ca`、`05_done/2026-10-13-talk-ime-enter.md`）。判定は `app/ui/keys.js` の `isSubmitEnter` / `isImeEnter` |
| A3 | `lib/talk.mjs:122` | プロンプトは `existingCandidateId` を返させるのに、読む側は `existing_candidate_id` を見ている。「既存の候補と同じか」の判定が一度も効かない |
| A4 | `lib/talk.mjs:315` | 会話での使用を判定する SQL の正規化が、`normalizeAnswer` と違う。短縮形やカンマのある例文が一致せず、会話での使用の記録が付かない |
| A5 | `lib/confusion.mjs:119` | `submissionId` に `pairId` を入れて返している |
| A6 | `lib/attempt.mjs:599` | 再判定で、同じ依頼の再送かを確かめる前に AI を呼ぶ。再送のたびに課金される。同時に来ると一意制約違反で 500 になる |
| A7 | `lib/practice.mjs:129` | 練習の取得の冪等キーに `skill_key` が入っていない。再送時に、別の表現の問題文と古い問題 ID が組み合わさって返る |
| A8 | `app/screens/train.js:106-111, 186-193` | 確認問題に答えた直後、古い計画データから同じ確認問題がもう一度出る |
| A9 | `app/screens/train.js`、`quiz.js`、`records.js` | エラーが出ても成功扱いで進む箇所と、再試行してもエラー表示が消えない箇所がある（混同ペアの登録、再チェック、回答送信） |
| A10 | `lib/candidates.mjs:103` | 候補から作るすべての問題に、採点契約 `adaptive:REQ-001` を流用している |

### B. サーバー（`src/lib`）の構造

1. **トランザクション内で AI を待つ**
   - `talk.mjs` の `sendTalkMessage`（206〜389 行）と `endTalkSession`（429〜547 行）は、ロックを取ったトランザクションの中で AI を最大 45 秒待つ。
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
   - DB なしでは試せない。AI は `fetch` を直接呼ぶので、差し替えにくい（`settings.test.mjs` は `globalThis.fetch` を丸ごと差し替えている）。
10. **応答のあとに裏で採点している**
    - `attempt.mjs:9, 271-277` は、記述回答の採点を応答を返したあとに走らせ、プロセス内の `inFlight` で重複を防いでいる。
    - 開発サーバーを止めると、採点は途中で消える。修復処理（`repairAttemptSideEffects`、279 行〜）と画面の 2 秒ごとの問い合わせで後から補っている。
    - Vercel では応答を返すと関数が止まるので、そのままでは採点が終わらない（クラウド対応のアイディアの C3）。

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
   - アプリが `source` を書き換えるので、YAML 同期の対象から行が抜ける（`boundary.mjs:98` が誤答を見つけると `catalog` を `observed_mistake` にする）。今は 34 ペアのうち、`catalog` 31、`observed_mistake` 1、`learner_registered` 2。
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
8. ~~**テストが本物の設定を切り替える**~~ **直した**（コミット `374e793`、`05_done/2026-10-13-isolate-test-database.md`）。
   - `npm test` は毎回作り直す `speak_kit_test` で流れる。`settings.test.mjs` が切り替えるのは、テスト用 DB の設定だけになった。
9. **認証が無いまま設定を変えられる**（owner 判断で見送り中。同レビューの R3）
   - `POST /api/settings` は誰でも呼べる。開発サーバーは LAN に開いている。
   - 同じ Wi-Fi の誰でも、AI のオン・オフを切り替えられる。
10. **`/api/ai/status` は、もう画面から使われていない**
    - 設定画面は `/api/settings` を使う。各画面は RPC の応答の `aiAvailable` / `aiReason` を使う。
    - 呼んでいるのは、どこからも描画されない `app/ai/panel.js` だけである。

### F. 教材の YAML 管理（2026-10-13 追加分の再調査）

対象: `src/lib/content/{schema,derive,sync,export,state}.mjs`、`src/cli/data.mjs`（コミット `374e793` 時点）。

**できていること:**

- YAML の書き間違いを「ファイル名:行」で出し、DB に触る前に止める。
- 反映は 1 トランザクションで、学習の記録の件数が変わったら取り消す。
- 回答の記録が指している確認問題は書き換えさせない（止めて、新しい問題として足させる）。
- 差分の計算（`planSync`）と反映（`applySync`）が分かれている。

**問題:**

1. **教材を DB に作る処理が 3 か所にある**
   - YAML の同期（`content/derive.mjs`・`sync.mjs`）: 表現 1 つから、練習問題を最大 8 種（CR・RG・SR・CD・FP・RT×3）とクイズを作る。
   - 会話の候補の承認（`candidates.mjs:84-105`）: 練習問題を CR の 1 種だけ作る。クイズは作らない。
   - 混同ペアの登録（`confusion.mjs:76-106`）: ペアと確認問題だけを作る。確認問題のクイズは作らない。
   - 同じ「表現」や「ペア」でも、どの入口から入ったかで、練習できる種類が違う。規則を直すときに 3 か所を揃える必要がある。
2. **採点契約の作り方が 3 通りある**
   - YAML の同期: 練習問題ごとに `adaptive:<exercise_key>` を作る（`sync.mjs:273-284`）。D-3 の「問題ごとの複製」を増やし続ける。今 326 行。
   - 候補の承認: 別の問題の契約 `adaptive:REQ-001` を流用する（A10）。
   - 内容の指紋（`content_hash`）も、同期は `derive.mjs` の `contentHash`、候補は `hashParts` で、計算が違う。
3. **教材の欄と学習状態の欄が同じ行にあることへの回り道**（D-1 の影響）
   - 同期は、混同ペアの `source` が `catalog` かどうかで 5 か所の分岐（`sync.mjs:203, 221, 239, 258, 264`）を持つ。
   - 画面から登録されたペア（`learner_registered`）は YAML に書き出せるが、YAML からは足せない。空の DB を作るとき（テスト用 DB）は `--catalog-only` で飛ばしている。DB を作り直すと、この 2 ペアは YAML からは戻らない。
4. **SQL と差分の計算が同じ関数にある**
   - `planSync` は、変更の一覧に SQL を書いた関数をそのまま入れている。差分の計算だけを DB なしでテストできない（今の `content.test.mjs` は、検査と導出だけを試している）。
   - 表現・練習問題・クイズ・ペアの INSERT / UPDATE が `sync.mjs` にあり、`candidates.mjs`・`confusion.mjs` の INSERT と同じ表を別々に書いている。
5. **DB の規則を JavaScript でも持っている**
   - 「〜、…、{} が残っていないか」の判定が、DB の関数 `has_unresolved_placeholder` と `schema.mjs:36-41` の 2 か所にある。片方だけ直すと、検査は通るのに反映で落ちる。
   - 選べる値の一覧（カテゴリ、能力、ペアの種類など）も `derive.mjs:3-15` にあり、DB の CHECK とは別に持っている（D-6 で能力の一覧表が無いことと同じ問題）。
6. **学習の記録の件数の見張りが一部の表だけ**
   - `state.mjs:39-54` の `learningCounts` は 7 表だけを数える。`conversation_turns`、`training_plans`、`confusion_events` などは見ていない。
7. **書き出しの対象が固定の学習者**
   - `state.mjs:21` は `learner_key = 'default'` を直書きしている（B-6 と同じ）。

### G. テストの DB と起動の足回り（2026-10-13 追加分の再調査）

1. **schema を流すスクリプトが 2 本ある**
   - `scripts/apply-local-schema.sh` は DB 名が `speak_kit` 固定で、前提の role と表が既にある DB にしか流せない。
   - `scripts/reset-test-db.sh` は、前提の role `job_control_api` と表 `public.flow_schema_migrations` を自分で作ってから 29 本を流す。表の定義を手で写している。
   - どちらも適用の記録を持たない（D-8）。
2. **DB の接続先の既定値が 5 か所にある**
   - `db.mjs:8`、`settings.mjs:18`、`cli/data.mjs:20`、`package.json` の `test`、`reset-test-db.sh:37`。ユーザー名 `kurosawa` も入っている。
   - 接続してよい DB 名（`speak_kit` / `speak_kit_test`）の検査は `db.mjs` にだけある。クラウドの Supabase（DB 名 `postgres`）にはつながらない（クラウド対応の C1）。
3. **`Pool` が既定の設定のまま**（`db.mjs:19`）
   - 接続数の上限や、接続プーラーを前提にした設定が無い（クラウド対応の C2）。
4. **テストの重さ**
   - `npm test` は毎回、空の DB に 29 本を流して教材を入れる（約 3 秒）。同時に 2 つ流すと、互いの DB を消し合う。
   - DB を使わない純粋な関数のテストが少ない（B-9）。
5. **毎日の起動が開発モード**（実運用レビューの H6・H7）
   - 開発サーバーと本番ビルドが同じ `.next` を使う。開発サーバーを動かしたまま `next build` すると壊れる。

### ほかの文書から来た要件

この案の外で見つかった問題のうち、構造の変更で直すものを、ここで段に割り当てる。

| 出どころ | # | 内容 | 割り当て |
|---|---|---|---|
| 実運用レビュー | H1 | 会話の「もう一度話す」が壊れている | A1（第 1 段） |
| 実運用レビュー | H2 | 会話を終えずに画面を移ると、会話が開いたまま残る | C-1（第 4 段）。それまでの間は第 1 段で、画面を離れるときに会話を終える |
| 実運用レビュー | H3 | ロックを持ったまま AI を待つ | B-1（第 3 段） |
| 実運用レビュー | H4 | 再判定の再送のたびに AI を呼ぶ | A6（第 1 段） |
| 実運用レビュー | H5 | 「既存の候補と同じか」の判定が効かない | A3（第 1 段） |
| 実運用レビュー | H6・H7 | 毎日が開発モード、`.next` の共有 | G-5（第 5 段。起動の手順は R4 と一緒に owner 判断待ち） |
| 実運用レビュー | H8 | AI の利用量に上限が無い | 第 3 段の `server/ai`。1 日 2 ドル・1 か月 20 ドル（O4） |
| 実運用レビュー | H9 | サーバーのエラーが記録に残らない | B-7（第 3 段）。route で例外を envelope にするときに記録も残す |
| クラウド対応 | C1 | DB 名の検査で Supabase につながらない | 第 3 段の `server/config.mjs` |
| クラウド対応 | C2 | `Pool` の設定 | 第 3 段の `server/config.mjs` と `db` |
| クラウド対応 | C3 | 応答のあとの裏の採点 | B-10（第 3 段の attempt） |
| クラウド対応 | C4 | AI の待ち時間と関数の上限 | B-1（第 3 段の talk） |
| クラウド対応 | C5 | ローカル専用の前提がある SQL 29 本 | 第 2 段の baseline |

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
src/server/config.mjs           起動時の設定（learner_key、ドメイン、タイムゾーン、DB の接続先と種類（local / supabase）と
                                接続してよい DB 名、Pool の上限、ログインの有無、AI のモデル・タイムアウト・利用量の上限、閾値）。
                                環境変数を読むのはここだけ。CLI・テスト・設定画面の「起動時の設定」もここから読む
src/server/content/             教材を DB に作る処理の 1 か所。YAML の同期、候補の承認、混同ペアの登録がここを呼ぶ
  derive（表現→練習問題・クイズ、ペア→確認問題・クイズ。純粋な関数）、diff（YAML と DB の差分。純粋な関数）、
  schema（YAML の検査）。SQL は repo/content に置く
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
- **教材の作り方は 1 つにする。** 入口（YAML、候補の承認、ペアの登録）が違っても、同じ表現・ペアからは同じ種類の練習問題・クイズと、同じ採点契約ができる。
- **重い処理は応答の前に終えるか、`after()` で走らせる。** プロセス内の `inFlight` と修復処理に頼らない。
- **DB の規則は DB を正にする。** YAML の検査は、DB の規則と同じ一覧・同じ関数を使っていることをテストで確かめる。

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
| 教材 | `confusion_pairs` | **分ける。** 教材の欄だけを残し、`learner_key` を外す。出どころ（catalog / learner / observed）は書き換えない。`skill_key_a/b` は FK にする。今ある画面から登録されたペア 2 件は移さない（O1）。誤答から見つかった印の付いた because / that's why は、教材（catalog）として移す |
| 学習状態 | `learner_confusion_state`（新） | 学習者×ペアで、回数、連続正解、待ちの側、配信中の確認問題、次の出題日を持つ。`confusion_probes.last_served_at` もここへ移す |
| 教材 | `confusion_probes` | 残す。文を変えるときは上書きせず、新しい版を足す |
| 採点 | `assessment_contracts` | 問題ごとの 324 行を、採点の版ごとの約 8 行にまとめる。YAML の同期も、問題ごとに契約を作らず、採点の版の契約を指す |
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
| 記録 | `ai_usage`（新） | AI の呼び出しごとの使用量と金額。利用上限の判定に使う（O4） |

migration の作り直し:

- 参照元からコピーした 28 本は `sql/archive/` に移して保存する。
- 新しい 1 本の baseline（表・制約・索引・トリガー・関数）と、`schema_migrations` で記録しながら流す適用スクリプトに置き換える。
- 教材の seed は SQL に持たない。YAML から `npm run data:sync -- --apply` で入れる。
- 空の DB に、手作業なしで乗ること（role の作成も baseline に含める）。`public.flow_schema_migrations` への依存は外す。
- 適用スクリプトは 1 本にし、DB 名を引数で受ける。`scripts/apply-local-schema.sh` と `scripts/reset-test-db.sh` の 2 本は、これを呼ぶだけにする。
- Supabase（クラウド対応の工程 2）にも同じ baseline を流せるようにする。

## 段階計画

各段は 1 つの task として `03_active/` に出す。段ごとに `npm test`（`speak_kit_test` で流れる）、`npx next build`、キー無しで今日 → クイズ → 回答 → 記録の経路を確かめてから次へ進む。`npx next build` は、開発サーバーを止めてから流すか、出力先を分けてから流す（G-5）。

### 第 1 段: バグの修正（A1、A3〜A10）

- 構造は変えずに直す。1 件ごとにテストか画面の操作で再現し、直ったことを確かめる。
- A2 は直した（`05_done/2026-10-13-talk-ime-enter.md`）。
- 実運用レビューの H1・H5 は A1・A3 と同じもの。H4 は A6。毎日使うときの痛みが大きいので先に直す。
- H2（会話を開いたまま画面を移る）は、第 4 段までのつなぎとして、画面を離れるときに会話を終える。
- A10（採点契約の流用）は第 2 段の契約のまとめ方で形が変わる。第 1 段では「別の問題の契約を指さない」ことだけを直す。

### 第 2 段: DB の作り直し

1. owner の判断で、試用の学習記録を捨てるか残すかを決める（Owner-only Decisions）。今の記録には、テストが書いた偽の回答が混ざっている（`05_done/2026-10-13-isolate-test-database.md` で片付けを見送った分）。
2. 新しい baseline と、DB 名を引数で受ける 1 本の適用スクリプトを書き、空の DB `speak_kit_next` で試す。
3. `data/confusion_pairs.yaml` から、画面から登録されたペア 2 件を消し、because / that's why の `source: observed_mistake` を外す（O1）。YAML 同期で教材を入れ、件数を確かめる。表現 51、練習問題 325、クイズ 257、混同ペア 32、確認問題は 136 から消した 2 ペアの分を引いた数。
4. 同期（`src/lib/content/sync.mjs`）を新しい表の形に合わせる。`source` の分岐（F-3）と、問題ごとの採点契約の作成（F-2）をなくす。`--catalog-only` が要らなくなるか確かめる。
5. `scripts/reset-test-db.sh` を、新しい適用スクリプトを呼ぶだけにする。前提の role と表を手で作る部分（G-1）を消す。`npm test` が通ることを確かめる。
6. 記録を残す場合は、移す SQL を書いて件数を突き合わせる。
7. `speak_kit` を入れ替える。元の DB は `pg_dump` で保存してから入れ替える。

### 第 3 段: サーバーの層の分離

1. `config.mjs`、`http/validate.mjs`、`domain/*` を作り、純粋な関数に単体テストを付ける。
   - `config.mjs` に、DB の接続先の既定値（今 5 か所。G-2）、接続してよい DB 名、`Pool` の設定、データの置き場の種類（local / supabase）を集める。CLI とテストもここから読む。
2. 教材の作り方を `server/content/` の 1 か所にまとめる（F-1・F-2・F-4）。
   - YAML の同期、候補の承認（`candidates.mjs`）、混同ペアの登録（`confusion.mjs`）が同じ導出の関数を呼ぶ。
   - 候補の承認は、YAML の表現と同じ項目（キー、コード、例文の英語と日本語、段階、種類）を受け取り、同じ種類の練習問題を作る（O2）。クイズは、YAML と同じく、紛らわしい選択肢が書かれたときだけ作る。
   - 承認した表現は `npm run data:export` で YAML に取り込み、YAML を正本に戻す。この手順を `data/README.md` に書く。
   - 差分の計算を純粋な関数にし、DB なしでテストする。
   - YAML の検査の一覧と DB の規則が一致することをテストで確かめる（F-5）。
3. `repo/*` に SQL を移す。重複している SQL（再チェックの基準時刻、「覚えた」の判定、推定値の集計、採点・証拠の INSERT）は 1 つにまとめる。
4. `services/*` を 1 つずつ作り、トランザクションの境界を決める。順番は影響の大きい順:
   - ai（AI の窓口。利用量を `ai_usage` に記録し、1 日 2 ドル・1 か月 20 ドルで止める。O4、H8）
   - talk（AI をトランザクションの外へ。H3、クラウドの C4）
   - attempt（修復処理を消す。裏の採点を `after()` にするか、応答の前に終える。B-10、クラウドの C3）
   - confusion
   - quiz
   - plan・progress
   - candidates
   - gate
5. `handlers/*` と `route.js` で、エラーを 1 つの envelope にそろえる。想定外の例外はファイルにも記録する（H9）。
6. 使われていない `lib/ai/features.mjs`、`/api/ai/*`（`/api/ai/status` を含む）、`app/ai/*`、未使用の export を消す。
7. 設定を RPC にまとめる（E の 1〜6）。
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
- 毎日の起動を開発モードから外し、本番ビルドの出力先を開発用と分ける（G-5、実運用レビューの H6・H7。R4 の起動手順と一緒に owner 判断）。

## 他のタスクとの関係

- `05_done/2026-10-13-content-yaml-in-data.md`（2026-10-13 完了）
  - 第 2 段は、この YAML 同期を教材の入れ方として使う。
  - 逆に、同期の今の作りは `confusion_pairs` の `source` で分岐する前提になっている。第 2 段の分割に合わせて直す（F-3）。
- `05_done/2026-10-13-isolate-test-database.md`（2026-10-13 完了）
  - `npm test` は `speak_kit_test` を毎回作り直す。第 2 段で、作り直しを新しい baseline に切り替える。
  - 本物の `speak_kit` に残っている偽の回答は、第 2 段の作り直しで捨てる前提で片付けていない。
- `05_done/2026-10-13-talk-ime-enter.md`（2026-10-13 完了）: A2 を直した。
- `05_done/2026-10-13-commit-and-push.md`（2026-10-13 完了）: 段ごとの変更は、何をしたかが分かるメッセージでコミットする。
- `02_backlog/実運用可能な状況かをレビュー依頼.md`
  - H1〜H9 を、この案の段に割り当てた（「ほかの文書から来た要件」）。
  - R1（バックアップ）・R3（LAN に開いている）・R4（起動の手順）は owner 判断で見送り中。第 2 段で `speak_kit` を入れ替える前の `pg_dump` は、この案の中で取る。
- `01_idea/クラウドインフラ対応.md`
  - C1〜C5 のうち、C5 は第 2 段、C1〜C4 は第 3 段で直る。クラウドの工程 1（コードの準備）の大半が、この案の第 2・3 段と重なる。
  - owner の判断（O3）で、クラウドはこの案の後にする。急がない。
- `05_done/2026-10-13-settings-screen.md`（2026-10-13 完了。今の DB に `learner_settings` を足し、画面は今のタブ「設定」で作った）
  - `learner_settings` は第 2 段の baseline に入れる。
  - 画面は第 4 段の新しいルート（`/settings`）で作る。
- `02_backlog/2026-10-13-close-remaining-original-gaps.md`
  - 参照元との差分 47 件は、「参照元から改良する」方針に変わったので、そのままは追わない。
  - 残す項目を第 3・4 段の中で選び直す。

## Non-scope

- 音声、ログイン、複数の学習者を画面で切り替えること。表に `learner_key` は持たせるが、使うのは `default` だけ。
- 実運用レビューの R1・R3・R4（owner 判断で見送り中）。
- TypeScript への移行。必要なら第 3 段の後で別タスクにする。
- Supabase と Vercel への反映（`01_idea/クラウドインフラ対応.md`）。この案は、そのための DB とコードの形を先に整えるところまで。
- 16 個の RPC 名の変更。画面と API の名前は第 3 段でも保つ。

## Risk

- 第 2 段で記録を残す場合、採点契約の統合は不変トリガー付きの 2 表（`exercises` 432 行、`exercise_definitions` 325 行）の参照を張り替える。いちばん壊れやすい。
- 第 3 段は全 RPC の応答に触れる。応答の形が変わると画面が壊れる。段の前に、RPC ごとの応答を固定したテスト（golden）を足してから始める。
- AI をトランザクションの外に出すと、「AI の応答を得たが書き込む前に別の操作が入る」場合が出る。書き込み時に状態を再確認する。
- 教材の作り方を 1 つにすると（第 3 段の 2、O2）、候補の承認で作られる練習問題が CR の 1 種から最大 8 種に増える。今日の計画に出る量が増える。承認済みの FREEZE_2（今は retired）は対象外。
- AI の利用上限は、価格表とモデルが変わると実際の金額とずれる。モデルを変えるときは `server/config.mjs` の単価も直す。
- 第 2 段で DB を作り直すと、`npm test` の準備と `data:sync` の両方が新しい形に依存する。テスト用 DB で先に通してから、本物を入れ替える。

## Owner-only Decisions

- 段ごとに `03_active/` へ移す承認
- 試用の学習記録 → 決定済み（O5: 捨てる）
- 画面から登録された混同ペアの扱い → 決定済み（O1: 残さない）
- 候補の承認から作る練習問題の種類 → 決定済み（O2: YAML と同じ）
- クラウドに出す時期 → 決定済み（O3: この案の後。急がない）
- AI の利用量の上限 → 決定済み（O4: 1 日 2 ドル、1 か月 20 ドル）
- `learners` 表 → 決定済み（O6: 列だけ）
- 使われていない AI 機能 → 決定済み（O7: 消す）

## Evidence Required

- 段ごとに `npm test` と `npx next build` の出力
- 第 2 段: 新旧の DB の教材の件数の突き合わせ、空の DB に手作業なしで乗ったログ、新しい baseline の `speak_kit_test` で `npm test` が通った出力
- 第 3 段: AI を待つ間に DB のロックを持っていないこと（テストで AI の応答を遅らせ、別の操作が待たされないことを確かめる）
- 第 4 段: リロード・戻る・リンクで同じ画面が開くこと

## 実施記録

### 第 1 段（2026-10-13 19 時台）

直したもの:

- A1・H1: 「シナリオを選び直す」で `session_id` を作り直す（`talk.js`）。画面で確かめた: 開始の失敗 → 選び直し → 同じ相手で、2 回の開始が別の `session_id` で送られた。
- H2（つなぎ）: 会話の途中で画面を離れたら、サーバーで会話を終える（`talk.js` の後片付け）。
- A3・H5: 候補の抽出で `existingCandidateId` を読む（`talk.mjs`）。
- A4: 会話での使用の判定を、`normalizeAnswer` で例文と発話の両方を正規化して比べる（`talk.mjs`）。テスト: 「That is why I started learning English」が `CAUSE_THATS_WHY` に数えられる。
- A5: 確認問題の応答の `submissionId` に、送られた値を返す（`confusion.mjs`）。
- A6・H4: 再判定の再送の確認を AI の前に行い、ロックの中でもう一度確かめる。再送の鍵は `regrade` / 回答 / 再判定の ID だけにした（`attempt.mjs`）。テスト: 同じ再判定の再送で AI の呼び出し回数が増えない。
- A7: 練習の取得の冪等キーに `skill_key` を入れ、再送では保存済みの問題を返す（`practice.mjs`）。テスト: 同じ ID・同じ表現は同じ問題、違う表現は別の問題。
- A8: 答えた確認問題を覚えておき、古い計画データから同じ確認問題を出さない（`train.js`）。
- A9: `useRpc` に `reset()` を足した。失敗したら先へ進まない（混同ペアの登録、再チェック）。再試行で前のエラーを消す（練習、クイズ）。混同ペアの登録の失敗を表示する。
- A10: 候補の承認で、問題ごとの採点契約 `adaptive:<exercise_key>` を作って指す（`candidates.mjs`。第 3 段で作り方を 1 つにする）。
- 準備: 本番ビルドの出力先を `NEXT_DIST_DIR` で分けられるようにした（`next.config.mjs`）。`NEXT_DIST_DIR=.next-build npx next build` なら、動いている開発サーバーを壊さない。

確かめたこと:

- `npm test`: 30 件中 30 件が通った（新しい `src/test/fixes.test.mjs` の 5 件を含む）。
- `NEXT_DIST_DIR=.next-build npx next build`: 成功。開発サーバー（3000）は動いたまま 200 を返した。
- 開発サーバーで `get_today_plan_v2`・`quiz_next_v1`・`get_progress_v2` が `ok`。


### 第 2 段（2026-10-13 19 時台）

やったこと:

- 新しい baseline `sql/migrations/20261013200000_baseline.sql` を 1 本作った。元の 29 本は `sql/archive/` に移した（中身は変えていない）。
  - 消したもの: `attempt_responses`（表・トリガー・関数）、ビュー `evaluations`、`learning_policy`。
  - `confusion_pairs` は教材の欄だけにした（`learner_key` と学習の状態の欄を外し、二つのラベルで一意。`skill_key_a/b` は FK）。
  - 学習の状態は新しい `learner_confusion_state`（学習者×ペア）と `learner_probe_state`（学習者×確認問題の最後に出した時刻）へ移した。読むときはビュー `learner_confusion_pairs` で教材と状態を合わせる。学習者の表は作らない（O6）ので、このビューは今は `default` の学習者だけを出す。
  - `training_attempts`・`grading_observations`・`capability_evidence`・`conversation_sessions` に `learner_key NOT NULL DEFAULT 'default'` を足した。
  - 能力の一覧 `capabilities`（9 件）を足し、能力の列 7 か所から FK で指す。
  - よく通る経路の索引を 14 本足した。
  - `ai_usage` を足した（第 3 段の利用上限で使う）。
  - 採点契約を、採点の版ごとの `rubric:<版>` 9 行と、`quiz-choice`・`confusion-probe` の計 11 行にまとめた（元は 327 行）。YAML の同期と候補の承認は `rubric:<版>` を指す。
  - `learning_policy_versions` と `learner_phase_gate_policies` の `effective_at` を固定の日時にした（v1 と v2 が同じ時刻にならない）。
  - role `job_control_api` と `public.flow_schema_migrations` への依存はなくなった。
- 適用スクリプトを `scripts/db-apply.sh <DB 名>` の 1 本にした。当てたファイルの名前とチェックサムを `public.schema_migrations` に残し、当て済みのファイルが書き換わっていたら止まる。`apply-local-schema.sh` と `reset-test-db.sh` はこれを呼ぶだけ。
- コード: 混同ペアの状態の読み書きを新しい表へ移した（`boundary.mjs`・`confusion.mjs`・`quiz.mjs`・`content/state.mjs`）。誤答で `source` を書き換える処理はなくした。
- 画面からの混同ペアの登録で、すでに教材にあるペアなら AI を呼ばず、教材と確認問題を書き換えず、学習の状態だけを最初からにする。
- YAML（O1）: 画面から登録された 2 件を消し、because / that's why の `source: observed_mistake` を外した。`source` に書けるのは `catalog` と `learner_registered` だけにした。
- `--catalog-only` は要らなくなったので消した。画面から登録したペアを書き出した YAML も、空の DB に入れられる。
- `speak_kit` を入れ替えた（O5）。
  - 元の DB は `~/backups/speak-kit/speak_kit_20261013192250.dump` に保存した。
  - 元の DB は `speak_kit_old_20261013192250` の名前で残してある。
  - AI の設定（オン）は同じ値。

確かめたこと:

- `npm test`: 32 件中 32 件が通った。新しいテストは 2 件。
  - 確認問題の回答は状態だけを変え、教材の行は変えない。
  - 教材にあるペアの登録では AI を呼ばない。
- 空の DB に手作業なしで乗った（`speak_kit_next` に baseline 1 本 → YAML 同期で 793 件の追加）。もう一度流すと、適用 0 件、同期の差分 0 件。
- 新しい `speak_kit` の件数:
  - 表現 51、練習問題 325、クイズ 257、混同ペア 32、確認問題 128、採点契約 11。
  - 学習の記録はすべて 0。
- 開発サーバー（3000）は入れ替えのあともそのまま動いた。`get_today_plan_v2`・`get_progress_v2`・`quiz_next_v1`・`evaluate_phase_gate_v2` が `ok`。記録の画面は「32 対を監視」「安定 0 / 257 問」を出した。
- `NEXT_DIST_DIR=.next-build npx next build`: 成功。

見送ったもの（この段ではやらない。理由は、記録を捨てたので後から足しても移行が要らないため）:

- `quiz_attempts` を `training_attempt_id` を主キーにした詳細だけの表にすること。
- `confusion_events` を「確認問題の結果」と「誤答から見つけた混同」に分けること。
- 会話の判定を、JSON ではなくターンの列を正にすること。
- 確認問題の文を変えるときの版の扱い（今は YAML 同期が書き換えを止めている）。

### 第 3 段（2026-10-13 19〜20 時台）

やったこと:

- `src/lib` をなくし、サーバーのコードを `src/server/` にまとめた。
  - `config.mjs`: 環境変数を読むのはここだけ。DB の接続先・接続してよい DB 名（`speak_kit` / `speak_kit_test`）・データの置き場の種類（local / supabase）・`Pool` の設定・AI のモデルと料金と利用上限・エラーログの置き場を持つ。`startupSettings()` もここ。CLI（`src/cli/data.mjs`）もここから読む。
  - `domain/`（`normalize.mjs`・`boundary.mjs`・`hash.mjs`）: DB も AI も使わない純粋な関数。単体テストを付けた。
  - `http/`（`envelope.mjs`・`validate.mjs`・`errors.mjs`）。
  - `content/write.mjs`: 教材を DB に書く SQL をここだけに置いた。YAML の同期、候補の承認、混同ペアの登録が同じ関数を呼ぶ。
- 候補の承認（O2）: YAML の表現と同じ形を作り、YAML と同じ検査（`expressionErrors`）と同じ導出（`deriveDefinitions`）を通す。tier1 の型なら、思い出す・意味を選ぶ・一部を入れ替える・間隔を空けた 3 本の練習問題ができる（元は 1 本）。code は空いている次の `P1-` 番号。すでにある key へまとめるときは `extra_examples` に 1 つ足す。手順は `data/README.md` に書いた。
- 混同ペアの登録も、YAML のペアと同じ形を作って `derivePair` → `insertPairContent` で書く。
- AI:
  - 1 回の操作の最初に「操作の文脈」（学習者、設定、キーの有無、今日と今月の使用額、AI を使えるか、使えない理由）を 1 度だけ決め、サービスへ渡す。理由は `setting_off` / `key_missing` / `limit_reached`。
  - AI の窓口 `askClaude` は文脈だけを見て送るかを決める。応答の `usage` から金額を出し `ai_usage` に残す。1 日 2 ドル・1 か月 20 ドル（`config.mjs`）に達したら送らない（O4）。
  - 使っていなかった `features.mjs`、`/api/ai/*`、`app/ai/*` を消した（O7）。
- トランザクション:
  - 会話（開始・発話・終了）は、AI の呼び出しをトランザクションの外へ出した。終了時の候補の抽出は、AI のあとで抽出済みかをもう一度確かめてから書く。
  - 文字の回答は、回答・採点・証拠・計画の完了・混同の記録・診断を 1 つのトランザクションにした。前の「途中で落ちたときの修復処理」は要らなくなったので消した。
  - 後回しの採点は、応答を返したあとに `next/server` の `after()` で走らせる。同じ回答の二重の採点は、新しい表 `grading_claims`（migration `20261013210000_grading_claims.sql`）で止める（2 分たった取りかけは取り直せる）。
  - 確認問題の回答と混同ペアの登録も 1 つのトランザクションにした。
- route（`src/app/api/[name]/route.js`）: どの応答も同じ envelope。`validation_error` は 400、`not_found` は 404、想定外の例外は 500 で `logs/server-errors.log` に 1 行ずつ残す（H9。`logs/` は git に入れない）。
- 設定: `/api/settings` を消し、RPC `skill_trainer_get_settings_v1` / `skill_trainer_save_settings_v1` にした。設定画面に今日と今月の使用額と上限、モデル名を出す。理由の文言は `labels.js` の `aiReasonLabel` の 1 か所（`limit_reached` を足した）。`useRpc` は `ai_unavailable` を理由の文言にする。
- RPC 名は、元の skill-trainer と同じ 16 個（`REFERENCE_RPC_NAMES`）と、speak-kit で足した 2 個（`LOCAL_RPC_NAMES`）に分けた。テストは元の 16 個と一致することを確かめる。

確かめたこと:

- `npm test`: 38 件中 38 件が通った。新しいテスト:
  - 使用額が 1 日の上限に達すると、AI に 1 回も送らず、理由が `limit_reached` になる。設定の RPC も同じ理由を返す。
  - 設定の RPC は真偽値以外を断り、応答に接続文字列を含めない。
  - 候補の承認で、YAML と同じ 4 種類の練習問題ができ、採点契約は `rubric:controlled-recall-v2` を指す。
  - 純粋な関数（答えの正規化、混同の目印、料金、上限の判定）。
- 実 DB `speak_kit` に `grading_claims` の migration を当てた（`schema_migrations` は 2 本）。`data.mjs check` は間違い 0、`data.mjs sync` は差分 0。
- `NEXT_DIST_DIR=.next-build npx next build`: 成功。
- 開発サーバー（3000）: `get_settings_v1`・`get_today_plan_v2`・`quiz_next_v1`・`get_progress_v2` が 200 で `ok`。知らない RPC は 404、`save_settings_v1` に文字列を送ると 400。設定の応答にキーや接続文字列は入っていない。設定画面に「今日の利用額 $0.00 / $2.00」「AI の利用上限 1 日 $2.00・1 か月 $20.00」が出た。
- 本物の AI で後回しの採点を 1 回通した: 最初の応答は `pending`、3 秒後の同じ送信で `graded`。`ai_usage` に 1 行（入力 1148・出力 86 トークン、0.003156 ドル）、`grading_claims` は 0 行に戻り、採点は 1 件だけ。この確認の回答 1 件は `speak_kit` の記録に残っている。

見送ったもの:

- `repo/*` に SQL を移すこと。読みの SQL（計画・進み具合・クイズ）は、まだ各サービスの中にある。学習者の `'default'` も、読みの SQL には直書きが残る（書く側は文脈の `learnerKey` を使う）。
- 差分の計算（`planSync`）を DB なしの純粋な関数にすること。
- 第 2 段で見送った DB の形の変更（`quiz_attempts`・`confusion_events`・会話のターンの列・確認問題の版）。
