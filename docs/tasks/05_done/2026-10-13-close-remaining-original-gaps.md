# 元の英会話学習との残りの差分 47 件を埋める

## Weight Class

- Class: Heavy
- Reason: 採点後の弱点診断、書いた答えでの混同検知、今日の計画モード、会話での使用記録を参照元へ戻す。ローカルの `speak_kit` に診断・混同・証拠の行を書く。
- Limits: live DB、Supabase への SQL、Vercel、secret のコミットは 0。
- Owner approval required: yes。`03_active/` へ移す指示があるまで着手しない。

## Goal

`private-ops` の学習｜英会話（画面は `frontend/retool/app-mirror/skill-trainer/frontend`、動作は `apps/skill-trainer/src/skill_trainer_adaptive.rs`、`skill_trainer_confusion.rs`、`skill_trainer_quiz.rs`、`domains/english_conversation.rs`）と、speak-kit の機能差を 0 にする。対象は 2026-10-13 に Rust と画面コードを突き合わせて見つけた 47 件。

前のタスク `03_active/2026-10-13-match-original-training-loop.md` の 26 箇所は、本線が通るところまで来た。ただし同じ機能とまでは言えない。このタスクはその残りを引き取る。

## Value

- integrity: 計画が「測る」だけで回り続け、弱点・混同・会話での使用が記録に一度も出ない状態を、完了扱いにしない

## Context

2026-10-13 時点の `speak_kit` の行:

- `weakness_diagnoses` は 0 行。採点しても診断が作られない。
- `capability_evidence` は `CONTROLLED_RECALL` の 1 行だけ。会話からの `CONVERSATION_USAGE` は 0 行。
- 混同ペアは「この二つが混ざる」で作った 2 組（`have a problem / take a problem`、`borrow a book / lend a book`）だけ。書いた答えからは開かれていない。
- 承認済みの候補 2 は、パターンが `x` である。キー無しの代替処理が、止まった発言をそのまま候補にしたものである。参照元なら候補にならない。これから練習項目 `FREEZE_2`（skill 52）と練習問題 `CANDIDATE-2-CR` ができている。

## Scope

参照元は読むだけ。各項目は、参照元と同じ入出力・同じ画面文言・同じ行で観測できたら完了とする。番号は 2026-10-13 の差分一覧と同じ。

### A. 採点後の学習ループ（バックエンド）

1. 文字回答・再判定の採点後に、参照元の `refresh_diagnosis` / `derive_weakness` で弱点診断を作り、更新し、解消する。計画の「練習する」「確かめる」、今日の「今の重点課題」、記録の「克服」と重点課題が、診断から出るようにする。
2. 今日の計画を作る前に、記憶確認（`spaced_retrieval` の 1・7・30 日）の診断 `RETENTION` を作る（`get_today_plan` の retention 予定の INSERT）。
3. 文字回答の採点後に `note_boundary_miss` を通す。参照元の 32 組の目印、`folded` 正規化、`confusion_events` の `mistake`、ペアの開き直しを写す。
4. 文字回答と再判定の応答に、`confusion`（`notice_for_attempt`）、`estimate`、`diagnosis`、`dimensions` を返す。再判定は `regradeId`、`observerVersion`、`adoptedForEvidence` も返す。
5. `defer_unknown: true` のとき、完全一致しない回答はすぐ `pending` を返し、裏で採点する（`ensure_deferred_grade`）。計画の項目は `awaiting_grade` にする。画面は 2 秒ごとに同じ提出を送り、結果を受け取る。
6. 影の採点（OpenAI での二重採点と `shadowGrader` の記録）。キーの方針で owner 判断が要る（Owner-only Decisions を参照）。
7. 同じ `attempt_id` を再送したとき、回答文に加えて回答時間・`session_id`・`occurred_at` も照合する。途中で失敗した副作用の修復（`repair_attempt_side_effects`）と、回復のための再判定を写す。画面から送られた `session_id` と `occurred_at` を保存する。
8. 計画を表示するとき、正解済みの問題を `skipped` にする（`Verify` を除く。`fetch_plan_response`）。

### B. 今日の画面

9. 「練習を始める」で今日の計画モードに入る。計画の問題そのもの（`exerciseInstanceId`）を順に出し、回答で計画の項目を完了する。「前の回答を確認しています」「今日の計画を完了しました」「学習記録を見る」を出す。
10. 計画が空のときは「実行可能な課題がありません」、読み込みに失敗したときは再試行ボタンを出す。「計画を作成中...」のまま止めない。
11. 重点課題に、弱点の種類のバッジ（`weaknessLabel`）を出す。
12. 計画が 0 件のとき「練習を始める」を押せなくする。
13. 計画モードの問題に「目的 · 理由」のバッジを出す。

### C. 実践練習

14. 回答時間を、問題を表示してからの実測で送る。0 固定にしない。
15. 「確認できませんでした」の回答に「再判定する」を出し、`skill_trainer_regrade_attempt_v2` を呼ぶ。
16. 混同の確認問題を、メインの問題カードに差し替えて出す。カードには「混同している二つを分ける」と両側の違い（label / key / direction）を出し、同じ回答欄で答える。結果は「これまでの回答」に成功か要復習として残し、違いも付ける。次の確認問題があれば続ける。
17. 練習の取得では、期限の来た確認問題を先に出す（`due_practice`）。今日の計画の `dueConfusion` は、練習画面が拾う。確認問題を出したら、`serving_probe_id` と `last_served_at` を記録する。
18. 「戻る」ボタンと「今日の練習／自由練習」の表示を出す。
19. `?tab=practice&skill=...` と `?plan=today` で、該当の練習を直接開けるようにする。
20. 日本語でないメッセージは、参照元の `uiErrorMessage` と同じく日本語の定型文に置き換える。解説欄とエラー欄の両方が対象。
21. 混同ペアの AI 下書きに、参照元と同じ構造化出力（`json_schema`）を使う。

### D. クイッククイズ

22. 回答後に結果パネルを出す。中身は「正解 ✓／不正解」、正解、「A と B を取り違えています」、違い（軸ラベル付き）、「この表現」、「間を空けて2回正解したので、もう出しません」。
23. 「次へ（Enter）」と「次は自分で言ってみよう（Enter）」のボタンを置く。選べるようになった直後に Enter を押したら、実践練習へ渡す。
24. 問題の上に、問題の種類（`TYPE_LABELS[item.quizType]`）を出す。
25. 回答後の選択肢の色を参照元に合わせる。正解は緑、選んだ誤答は琥珀、それ以外は灰色。

### E. 会話

26. 会話相手の役割の文を、`english_conversation.rs` の `TEACHER_PERSONA` / `LEARNER_PERSONA` / `FREE_TALK_PERSONA` の全文にする。冒頭の発言と各ターンの指示も、参照元の文にする。
27. 各ターンの判定に、それまでの会話履歴を渡す。
28. 発言が練習中の表現の例文と一致したら、`CONVERSATION_USAGE` の証拠（modality `conversation`、確かさ 90）を作る。`attributedSkillKeys` と `evidenceIds` を返す。
29. AI が使えないときは、参照元と同じく `TALK_TURN_FALLBACK` を返す。指標はすべて false にし、観察は `ungraded` で残す。疑問符・日本語・短文による独自の判定は消す。
30. 終了した会話への送信は `session_ended` で拒否する。同じ `turn_id` の再送は、入力を照合し、元の応答をそのまま返す。
31. 会話画面から回答時間を送る。
32. 言えなかった場面の候補は、参照元の `CANDIDATE_EXTRACTION_SYSTEM` と既存候補の一覧で抽出する。AI が使えないときや失敗したときは `pending_retry` にして、次の終了で再試行する。止まった発言そのものを候補にしない。
33. 終了の応答と画面を参照元に合わせる。応答は `scenario`、`durationSeconds`、`candidateExtractionStatus`、`promotedSkills` を返す。画面は「会話の要約 Nターン・N分」、平均応答時間を含む 6 つの指標カード、候補件数と「追加は確認後に行われます」の案内、「もう一度話す」を出す。
34. 会話の終了画面の承認／却下ボタンをどうするか。参照元には無い（Owner-only Decisions を参照）。
35. AI が使えないときの注意表示、吹き出し形式の表示、「返答中...」、送信と終了のエラー表示を、参照元に合わせる。

### F. 記録

36. 「詳細を見る／詳細を閉じる」を置く。開いた側に、会話の記録、表現ごとの習得状況、採点の状態を出す。習得状況は能力ごとの 6 指標と重点課題のバッジ。
37. `get_progress` の skills を参照元に合わせる。能力は「練習問題がある能力」と「記録がある能力」の和集合にする。各能力に status、観測期間、確かさ、最終観測日を付ける。並びは分類順、診断は最大 5 件で ID 付き。
38. 採点の状態を、採点方式×状態の件数（`observerVersion`, `status`）で返し、「ルール採点 · 採点済み N件」と出す。
39. 今週の欄に、反応速度（前 → 今）、会話時間の分表示（5 分以上なら分）、新しく安定した表現と克服した表現の一覧を出す。
40. 混同の境界の欄は、監視数が 1 以上のときだけ出す。取り違えたペア（`list_pairs`：`graded_count > 0`）の一覧を、正答数と両側の違い付きで出す。`confusionPairs` にクイズのペアを流用しない。
41. クイズの欄で、ペアに軸ラベルと「見れば分かるが、自力ではまだ出ない」を出す。並びはペアが先で、表記は「A と B」。データには、ペアの `choiceP50LatencyMs` と `stableItems`、表現の `stableItems` と `itemCount` を加える。
42. 会話の記録は詳細の側に置く。「Nセッション」、注記「会話全体の記録です。個別の習得度へは直接加点しません。」、平均応答時間を出す。数えるのは終了した会話だけにする。
43. 「覚えたものを再チェック」の実行中は「準備しています」と出す。再チェック待ちの文は 1 件以上のときだけ出す。

### G. サーバの処理（RPC）

44. `skill_trainer_record_human_observation_v2` を参照元どおり実装する。人の観察を保存し、証拠の選び方は人 > ルール > AI の順。
45. `skill_trainer_compare_observations_v2` を参照元どおり実装する。
46. `skill_trainer_get_trace_v2` は `plan_item_id` を受け取る。計画・課題・回答・採点・証拠・診断・次の項目と、各バージョンを返す。
47. `skill_trainer_evaluate_phase_gate_v2` の結果を参照元の形にする。全体と要件ごとの status は passed / not_passed / insufficient_evidence の 3 値にし、要件ごとに `estimate` を付け、`scenarioResults` を別に返す。比較子は `> < ==` まで扱う。集計は Phase 1 の有効な表現と、`text` / `conversation` の記録に絞る（`load_aggregate_estimate`）。

### 原本に無いもの

- AI が使えないときの独自の会話判定と、独自の候補作成（29・32）

## Non-scope

- 音声入出力
- 二人目の learner
- ログイン画面とセッション、Supabase への SQL、Vercel、配布用 GitHub
- 16 RPC 名の改名
- live の skill-trainer、`DB_FLOW_URL`、Retool

## Risk

- 診断（1・2）を入れると、計画の中身が「測る」から「練習する」「確かめる」に変わる。今日・練習・記録の表示が一斉に動く。
- 裏で採点する処理（5）が choice の経路を待たせると、キー無しの経路が止まる。
- 会話の代替処理を参照元に戻すと（29・32）、キー無しの会話では指標も候補も 0 になる。今の検証手順は、キー無しの候補作成に頼っている。
- 承認済みの `x` の行（候補 2、`FREEZE_2`、`CANDIDATE-2-CR`）が残ると、練習問題に `x` が出続ける。

## Change Condition

owner がこのファイルを `03_active/` へ移すと明示したとき。

## Done Condition

Scope の 1〜47（34 と 6 は owner の判断どおり）が、`http://localhost:3000/` の画面か、API の応答か、`speak_kit` の行で、参照元と同じに観測できるまで未完了とする。最低でも次を観測する。

- 誤答を 3 件以上入れた表現に `weakness_diagnoses` の active 行ができ、今日の計画に「練習する」が出る。改善したら resolved になり、記録の「克服」に載る。
- 「because」を求める問題に「That's why」と書くと、`confusion_events` に `mistake` ができる。次に練習を開くと、その確認問題が先に出る。
- 「練習を始める」で計画の問題を全部答えると、計画が completed になり、「今日の計画を完了しました」と出る。
- 会話で例文どおりの発言をすると、`CONVERSATION_USAGE` の証拠ができ、今日の「会話で使ってみる」から消える。
- キー unset のプロセスで、choice の today → quiz → submit → progress が成功し、Anthropic へ接続しない。`npm test` が全件通る。

一つでも欠けたら完了にしない。

## Owner Decisions（2026-10-13）

- 着手: 承認。`03_active/` へ移した。
- 6: AI は Anthropic の一つでよい。影の採点（OpenAI）は写さない。
- 34: 会話の終了画面の承認／却下は、owner が前のタスクで求めた流れなので残す。中身（承認時に作る項目）は参照元の `review_candidate` の入力に合わせる。
- `/api/ai/*` と `lib/ai/features.mjs` は残す。参照元では会話の AI 補助（`skill_trainer_local.rs` の判定ヘルパー）として別に存在し、無いと動かない。
- 「アプリ一覧」のリンク: 今回は対象外。
- 承認済みの `x` の行: テストで誤って作られた行なので、`FREEZE_2` と `CANDIDATE-2-CR` を `retired` にした（削除はしていない）。

## Capability Boundary

読み書きは、speak-kit のローカル Postgres `speak_kit` と、任意の Claude 呼び出しに限る。Claude には `AI_ANTHROPIC_API_KEY` だけを `ANTHROPIC_API_KEY` として渡す。本番デプロイ、secret の書き込み、課金設定、外部通知は使わない。

## Allowed Paths

- speak-kit のアプリコード、テスト、この task の Evidence
- 参照元は読取のみ

## Forbidden Paths

- `private-ops/apps/skill-trainer` への書き込み
- `DB_FLOW_URL`、live 学習者 DB、Retool、Supabase への SQL、Vercel
- `env/secret.yaml` のコミット、Doppler への `secrets set`
- `scripts/apply-local-schema.sh` の再実行

## Rollback Trigger

choice のキー無し経路が Anthropic を待つか、書き込み先が `speak_kit` 以外になったら、その時点で止めて owner に返す。

## Evidence Required

- 1〜47 のそれぞれについて、画面か API の応答か `speak_kit` の行
- Done Condition の 5 つの観測
- core のファイル（`lib/quiz.mjs`、`lib/plan.mjs`、`lib/dispatch.mjs`、`app/api/[name]/route.js`）に `lib/ai/client` と `api.anthropic.com` が無いこと（`test/ai-isolation.test.mjs`）

## Plan

1. 診断と混同の検知（1・2・3・4・8）。採点後の副作用と応答を参照元に揃える。
2. 回答時間と計画モード（14・9・13・10・12・11・18・19）。計画が回答で進むようにする。
3. 会話の証拠と代替処理（28・29・26・27・30・31・32・33・35）。34 は owner 判断のあとにする。
4. 練習の確認問題と再判定（17・16・15・5・7・20・21）。
5. クイズの結果パネル（22〜25）。
6. 記録（36〜43）。
7. RPC（44〜47）。6 は owner 判断のあとにする。
8. Done Condition を観測し、Evidence に残す。

## Stop / Ask Owner If

- 適用先が `speak_kit` 以外である
- 参照元の処理が `speak_kit` の schema に無い列や表を前提にしている
- Owner-only Decisions の項目に触れないと先へ進めない

## Evidence（2026-10-13）

観測の場所は 3 種類。

- 画面: `http://localhost:3000/`（dev server、キーあり）
- API: `dispatch` か `POST /api/<rpc>`
- 写し: `/tmp` に一時的な Postgres（port 5544）を立て、`pg_dump` で `speak_kit` を写したもの。DB 名は `speak_kit` のままなので、`lib/db.mjs` の検査を通る。観測のあと停止して削除した。

写しを使ったのは、時間の経過か大量の正解が要る観測（1 の解消、2、会話で使ってみる）と、人の観察の書き込み（44）である。owner の学習記録へ偽の回答を足さないためである。

### Done Condition

- 弱点診断: `weakness_diagnoses` d83313a4（INTENT / `CAUSE_THATS_WHY` / `SLOT_REPLACEMENT`、active、evidence_count 4）。新しい計画 b2af25d8 の先頭は「練習する · 場面に合う表現を改善するため」。
  - 写しで同じ問題に模範解答を 11 回入れた。正答率 0.8・p50 2000ms で `resolved` になった。`get_progress` の `weeklySummary.overcomeCount` は 1、`overcome` は `That's why ....`。この表記は Rust の `learner_phrase` と同じ。
- because / That's why: `confusion_events` に `mistake` 3 行。次に練習を開くと「混同している二つを分ける」カードが先に出て、「雨でした。だから家にいました。」が出題された（画面）。
- 計画の完了: 計画 0f878237 は `completed`。画面に「今日の計画を完了しました」と「学習記録を見る」が出た。
- 会話で使ってみる: 実 DB に `CONVERSATION_USAGE` 1 行（`REQUEST_COULD_YOU`、確かさ 90、会話 9 の turn 22）。
  - 写しで `CHUNK_FEEL_BETTER` に `controlled_recall` を 3 回正解させると、`route.talkReady` が `[]` から `["CHUNK_FEEL_BETTER"]` になった。
  - 会話で「feel better」と送ると、`gradingStatus` は `graded`、`attributedSkillKeys` は `["CHUNK_FEEL_BETTER"]`、`evidenceIds` は 1 件。`talkReady` は `[]` に戻った。
  - 抽出の SQL は Rust の `skill_trainer_quiz.rs` 687〜700 行と同じ。
- キー無し: `env -u ANTHROPIC_API_KEY node --test test/*.test.mjs` は 8/8 pass（写しで実行）。
  - core の 4 ファイルに `lib/ai/client` と `api.anthropic.com` は無い（`test/ai-isolation.test.mjs` と `rg`）。
  - キー unset のときの応答時間:
    - free_text（`defer_unknown`）は 6〜7ms で `pending`。再送 17ms で `ungraded`（`grader unavailable: ANTHROPIC_API_KEY is unset`）。
    - 会話の開始・送信・終了は 6 / 20 / 5ms。
    - 混同ペア登録は 0ms で `confusion_key_unavailable`。

### 項目ごと

- 1: 上の弱点診断を参照。今日の「今の重点課題」と記録の重点課題・克服は、診断から出る。
- 2: 写しで `CAUSE_THATS_WHY` の想起の正解を 2 日前へずらし、計画を作り直した。`RETENTION` / `RETENTION_1D` の active 行ができた（`evidence_snapshot.reason = retention_due`）。計画に「確かめる」（`spaced_retrieval`、`retention_due:RETENTION_1D`）が出た。
- 3・4: `mistake` 行と、境界の行・`notice_for_attempt` の応答。採点の応答は `confusion`、`estimate`、`diagnosis`、`dimensions` を返す。再判定の応答は `regradeId`、`observerVersion`、`adoptedForEvidence` を返す。
- 5: 計画の回答「Would you like to have lunch together?」は、まず `pending`（項目は `awaiting_grade`）で返った。2 秒ごとの再送で AI の成功と日本語の理由を受け取った。
- 6: owner 判断で対象外。
- 7: 写しで確かめた。
  - 同じ `attempt_id` で回答時間だけ変えると、`idempotency_conflict`（`attempt_id was already used with different immutable input`）。
  - まったく同じ再送は `idempotent_replay`。
  - 画面から送った `session_id` と `occurred_at` は `training_attempts` に保存される。
- 8: 計画の応答は、Verify 以外の正解済みの項目を出さない。並ぶのは planned / in_progress / awaiting_grade だけ（Rust の `fetch_plan_response` と同じ）。
- 9〜13: 今日の画面は Today.tsx の写し。計画モード、目的 · 理由のバッジ、空・失敗・0 件の表示、弱点の種類のバッジを画面で確認した。
- 14〜20: 実践練習は Train.tsx の写しで、次を画面で確認した。
  - 回答時間は実測で送る。「再判定する」が出る。
  - 確認問題のカード: 失敗は「要復習」と 5 項目、成功は「境界のこちら側は分かれました。」。期限の来た確認問題が先に出る。
  - 「戻る」、今日の練習／自由練習、`?plan=today` / `?tab=practice&skill=`。
  - 英語のエラーは `uiErrorMessage` で日本語の定型文になる。
- 21: 混同ペアの AI 下書きは `json_schema` の構造化出力を使う。
- 22〜25: クイズの結果パネル（正解 ✓、この表現、次へ（Enter））、問題の種類、選択肢の色を画面で確認した。
- 26〜33・35:
  - 会話の役割文・冒頭・各ターンの指示は、`english_conversation.rs` の全文。
  - teacher で AI の冒頭と返答が吹き出しで出た。
  - 終了画面には次が出た。
    - 「3ターン・0分」と 6 枚の指標カード（平均 10 秒）
    - 候補の案内と「もう一度話す」
  - 写しで確かめた。
    - 終了した会話 12 への送信は `session_ended`。
    - 同じ `turn_id` と同じ入力の再送は `idempotent_replay` で、元の返答を返した。
    - 発言だけ変えると `idempotency_conflict`。
  - キー無しでは `TALK_TURN_FALLBACK` を返し、観察は `ungraded`。
- 34: 承認／却下は残した（owner 判断）。終了画面の「候補の確認」に、候補 4「I'd like to change my schedule.」／「予定を変更したいです」が出た。
  - 送る中身は `review_candidate` の入力どおり（`stable_key: FREEZE_<id>`、`canonical_form`、`exercise_prompt`、`expected_reference`、`category: OUTPUT`）。
  - `candidate_id` が整数 999999 なら `not_found`、文字列 "999999" なら `validation_error`。Rust の `as_i64` と同じ。
  - 候補 3・4 は owner の確認待ちのまま残した。
- 36〜43: 記録は Progress.tsx の写しで、次を画面で確認した。
  - 詳細の開閉、6 セッション・平均 3.2 秒、表現 50 枚、採点の状態一覧。
  - 「覚えたものを再チェック」は、準備しています → 再チェック待ち 2 問 → 注記。
- 44: 写しで、AI 採点済みの回答 84063ebf に人の観察（`semantic` だけ fail）を記録した。結果は `outcome: failure`、`adoptedForEvidence: true`。有効な証拠は `ai / success` から `human / failure` に替わった。
- 45: `compare_observations` は `observationCount`、`hasOutcomeDisagreement`、各観察の `source`、`observerVersion`、`dimensions`、`outcome` を返した。
- 46: `get_trace` は `plan_item_id` f4cc3572 で、次を返した。
  - `planId`、`exerciseInstanceId`、`attemptId`、`gradingId`、`evidenceId`、`diagnosisIds`
  - `nextPlanItemId`（d003b1f9）
  - `versions`（policy / estimator / diagnosisRule / evidenceDerivation / evidenceSelection）
- 47: `evaluate_phase_gate` は次を返した。
  - 全体: `status: not_passed`
  - 要件ごと: `status: insufficient_evidence` と `estimate`
  - `scenarioResults`: teacher と learner は `not_passed`、free_talk は `insufficient_evidence`

### 参照元どおりに写した癖

- 会話の発言は短縮形を展開してから例文と比べる。例文の側は展開しない。そのため「That's why ...」は会話では `CAUSE_THATS_WHY` に帰属しない。
- 候補抽出の `existing_candidate_id` の示唆は、読むが使わない。
- `pair_notice` は、別の期限の来たペアを返すことがある。
- 確認問題の採点は、`folded` の完全一致。
- `skipped` の項目が残ると、計画は完了しない。「覚えたものを再チェック」で planned に戻る。
- 境界の行は `plan.data.dueConfusion` を優先するので、古いペアを出すことがある。
- `phase1-observer-ai-v7`、`quiz-choice-v1`、`confusion-probe-v1` の採点方法の表示は「採点方法不明」。
- envelope の `replayed` は常に false。再送は `code: idempotent_replay` で示す。

### 意図して参照元と変えたところ

- 会話の終了応答に `candidates`（この会話から出た未確認の候補）を足した。承認／却下のためである。
- 会話の開始中・開始失敗の表示を、場面選択の外に出した。参照元ではここに到達しない。
- 今日と練習の空・完了の表示に `data &&` を足した。読み込み前に一瞬出るのを防ぐためである。

### 実 DB に残した作業の跡

- 17:39:17〜17:39:20 に、16 の表現の言い換え練習へ、エージェントの模範解答の成功が 1 件ずつ入った。確認用のスクリプトが、`skill_key` を優先順位としてしか扱わない参照元どおりの選び方で、別の表現へ流れたためである。
  - 表は追記のみで、更新も削除もできない。owner の判断で、「覚えたものを再チェック」を 1 回実行した（`masteredPromptCount: 0`、`recheckDueCount: 18`）。行は残り、正答率には 1 件ずつ数えられたままである。
- `speak_kit` の回答 65 件は、すべて 2026-10-13 の検証中に作られた。
- `phase1-talk-rules-v1` の観察 4 行（会話 2・5・6・7）は、前の実装（08f46c8）の跡。今のコードは作らない。残した。
