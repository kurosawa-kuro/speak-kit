# 参照元 dispatch をローカル Postgres へ写し、キー無しで通す

## Weight Class

- Class: Heavy
- Reason: 参照元の schema 28 本と dispatch 16 本を、名前と挙動ごと写す。適用先は speak-kit 専用のローカル Postgres だけであり、live の `DB_FLOW_URL` には触らない。
- Limits: 実行は owner が「開始」と言うまでしない。live DB、secret 書き込み、Vercel、配布用 GitHub、Doppler への書き込みは 0。
- Owner approval required: yes

## Goal

`/Users/kurosawa/Dev/private-ops/apps/skill-trainer` のテキスト練習を、フル Next.js と speak-kit 専用ローカル Postgres の上で、`ANTHROPIC_API_KEY` unset のまま最後まで通す。通す経路は参照元の RPC 名のままとする。

## Value

- integrity: 独自の簡易フレーズアプリを完成扱いしない
- safety: AI 呼び出しと live DB と複数利用者を、この経路に入れない

## Scope

参照元は読むだけ。変更しない。写す単位は次で固定する。

SQL は `sql/postgres/` の 28 ファイルを、ファイル名の時刻順に speak-kit へコピーし、speak-kit 専用のローカル Postgres にだけ適用する。接続文字列は `DB_FLOW_URL` ではない。28 未満で止めた状態を完了にしない。

`src/skill_trainer_local.rs` の `dispatch` にある次の 16 名を、Next.js の route 名として残す。Rust の関数本体は載せない。同じ名前で同じ入出力を TypeScript で書く。

キー unset で最後まで成功させるもの:

- `skill_trainer_get_today_plan_v2`
- `skill_trainer_get_practice_v2`
- `skill_trainer_quiz_next_v1`
- `skill_trainer_submit_attempt_v2`（`response_mode=choice`）
- `skill_trainer_get_progress_v2`

route は存在するが、unset のときネットワークへ出さず、コアの成功を待たせないもの:

- `skill_trainer_submit_attempt_v2` の free_text 採点
- `skill_trainer_regrade_attempt_v2`
- `skill_trainer_start_talk_session_v2`
- `skill_trainer_send_talk_message_v2`
- `skill_trainer_end_talk_session_v2`
- `skill_trainer_review_candidate_v2`

残りも route として置き、参照元と同じ検証エラーを返す。名前を REST 風に変えない。

- `skill_trainer_register_confusion_pair_v2`
- `skill_trainer_record_human_observation_v2`
- `skill_trainer_compare_observations_v2`
- `skill_trainer_reset_review_v2`
- `skill_trainer_get_trace_v2`
- `skill_trainer_evaluate_phase_gate_v2`

文言は `src/domains/english_conversation.rs` の定数をコピーする。採点 fixture は `src/testdata/controlled_recall_grader_fixtures.json` をコピーする。利用者は一人。二人目の learner を作る経路は置かない。

## Non-scope

- 音声入出力
- 16 名の改名、画面用の別 API、独自の 3 問アプリ
- SQL の要約、テーブルの先行削減、参照元に無いカラム
- Vercel、Supabase project、配布用 GitHub、YouTube
- live の `skill-trainer`、`DB_FLOW_URL`、Retool、Job Control 用 Supabase
- Doppler `apps/dev` の丸ごと注入。`CLOUDFLARE_*` と `INFRA_GITHUB_MEMO_REMOTE_PAT`
- `speak-next`
- 未決（会話ログ、テンプレート化、Error Boundary の粒度、`aiEnabled` の再評価、401/429 の自動化）をこの task で決めること

## Risk

- 28 本を `DB_FLOW_URL` へ適用すると、毎日の学習 schema を壊す。
- choice 以外の submit で採点 API を待つと、キー無しの経路が止まる。
- 画面だけ作って RPC 名を捨てると、コピーではなく別アプリになる。

## Change Condition

owner がこのファイルを `03_active/` へ移すと明示したとき。保存先の再指名は要らない。適用先は speak-kit 専用のローカル Postgres で固定である。

## Done Condition

次の四つが全部観測できるまで未完了である。

1. ローカル Postgres に 28 ファイルが時刻順で適用され、適用ログに 28 と出る。`DB_FLOW_URL` への接続は 0。
2. unset のプロセスで、`get_today_plan_v2` → `quiz_next_v1` → `submit_attempt_v2`（choice）→ `get_progress_v2` が、この順で成功応答を返す。途中で Anthropic と ai-gateway へ接続しない。
3. 16 名すべてに route があり、名前が参照元の match と一致する。Talk と free_text 採点は unset で失敗応答を即返し、choice の応答をブロックしない。
4. 音声の route と UI が無く、learner を増やす route が無い。

一つでも欠けたら完了にしない。

## Owner-only Decisions

- `03_active/` へ移す承認
- ローカル Postgres の起動方法が参照元の運用と衝突するときだけ止める。DB の種類を Supabase や SQLite に変える判断は、この task ではしない

## Capability Boundary

schema 適用は speak-kit 専用ローカル Postgres に限る。本番デプロイ、secret 書き込み、課金、外部通知は使わない。任意 Claude の動作確認はこの task の完了条件に入れない。

## Allowed Paths

- speak-kit のアプリコード、コピーした `sql/postgres/`、`Makefile`、この task の Evidence
- 参照元は読取のみ

## Forbidden Paths

- `private-ops/apps/skill-trainer` への書き込み
- `DB_FLOW_URL`、live 学習者 DB、Retool
- `env/secret.yaml` のコミット、Doppler への `secrets set`
- クラウドのプロジェクトとデプロイ設定

## Rollback Trigger

Done の 1〜4 のどれかが失敗した変更は、その時点でローカル DB を作り直す対象であり、クラウド手順へ進めない。live へ適用していたら、その時点で作業を止め、適用先の接続文字列を Evidence に残して owner に返す。

## Evidence Required

実行後に残すもの:

- 適用した SQL ファイル名 28 の一覧と、適用先が `DB_FLOW_URL` でないことのコマンド出力
- 上記 4 呼び出しの要求と応答の要約。キーは unset
- その実行中に Anthropic へ出ていないことの確認
- 16 route 名の一覧と、参照元 `dispatch` の match との差分が空であること

承認前の今は未実行である。未実行を完了条件の代わりにしない。

## Plan

1. 28 SQL を時刻順にコピーし、空のローカル Postgres へ適用する。失敗したファイル名で止まる。
2. 16 route を先に空の検証エラーで並べ、名前の差分テストを置く。
3. choice の 4 呼び出しだけを、参照元の成功条件に合わせて実装する。free_text と Talk は unset で即返す。
4. Done の 1〜4 を順に実行し、欠ける項目を Evidence に残して完了にしない。

## Stop / Ask Owner If

- 適用先の URL が `DB_FLOW_URL` と同じ、または private-ops の既存 DB である
- 28 本のどれかが、参照元に無い前提（news schema、job_control role）なしでは適用できない
- choice の成功が、参照元では AI 採点の完了を待っている
- 16 名以外の RPC を足さないと画面が成立する
