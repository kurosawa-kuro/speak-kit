# 教材を `data/` の YAML で管理する

## Weight Class

- Class: Heavy
- Reason: 教材の正本を DB から `data/*.yaml` へ移す。YAML を DB へ反映する仕組みを作り、既存の学習記録が指している教材の行を壊さずに更新する必要がある。
- Limits: live DB、Supabase への SQL、Vercel、secret のコミットは 0。書き込み先は `speak_kit` だけ。
- Owner approval required: yes。2026-10-13 に owner が着手を指示した（「次これ」）。

## Goal

owner が `data/` の YAML ファイルを編集し、コマンドを 1 つ実行するだけで、表現・練習問題・クイズ・混同ペアを追加・修正・停止できるようにする。SQL を書く必要も、DB ツールを開く必要もない状態にする。

## Context

2026-10-13 時点:

- 教材はローカル Postgres `speak_kit` の `skill_trainer` スキーマにしか無い。入れたのは参照元からコピーした `sql/postgres/` の seed SQL である。owner が教材を変える手段は、DB を直接書き換えることしか無い。
- 教材の行数: 表現 `skill_concepts` 51、練習問題 `exercise_definitions` 325、クイズ `quiz_items` 257、混同ペア `confusion_pairs` 34。
- 1 つの表現（例: `REQUEST_COULD_YOU`）から、次の行ができている:
  - 練習問題 8 種: 思い出して答える `P1-025-CR`、意味を選ぶ `-RG`、一部を入れ替える `-SR`、使い分ける `-CD`、自由に作る `-FP`、記憶確認 `-RT-1D` `-RT-7D` `-RT-30D`。問題文は「例文の日本語」「意味」に決まった前置きを付けたもので、答えはすべて例文の英語である。
  - クイズ 3 種: 意味を選ぶ `QZ-ME-*`、用途から選ぶ `QZ-IN-*`、文を選ぶ `QZ-FO-*`。正解 1 つと、紛らわしい誤答 3 つ。誤答は自動では作れないので、人が書く必要がある。
  - 練習問題ごとの採点契約 `assessment_contracts`、問題の実体 `exercises`。
- 学習記録は教材を ID で指している（`training_attempts`、`quiz_attempts`、`capability_evidence`、`weakness_diagnoses` など）。教材の行を消して入れ直すと、記録との対応が切れる。
- `exercise_definitions` は `(exercise_key, version)` と `content_hash` で版を持つ。問題文を変えたら、上書きせず新しい版を作るのが今の約束である。
- `confusion_pairs` には教材の欄（2 つの表現、違いの説明）と、学習の状態の欄（`confusion_count`、`success_streak`、`next_due_at` など）が同じ行に入っている。`source` は `catalog`（教材）、`learner_registered`（画面で登録）、`observed_mistake`（誤答から検知）の 3 種類ある。
- 画面からも教材が増える。会話の候補の承認（`src/lib/candidates.mjs`）と、混同ペアの登録（`src/lib/confusion.mjs`）である。
- 承認済みの候補 2（パターン `x`、表現 `FREEZE_2`、問題 `CANDIDATE-2-CR`）は意味の無い行だが、練習に出ている。
- YAML を読むライブラリは入っていない。

## Scope

### 1. `data/` の構成

repo 直下に `data/` を置く。プログラムではなく教材なので、`src/` には入れない。

```text
data/
  README.md                 # 書き方と反映のしかた（日本語、例つき）
  expressions/
    output.yaml             # カテゴリごとに 1 ファイル
    query.yaml
    time.yaml
    action.yaml
    error_handling.yaml
  confusion_pairs.yaml      # 教材としての混同ペア（source = catalog）
```

### 2. 表現 1 件の書き方

owner が書くのは次だけにする。練習問題 8 種の問題文、採点の設定、版の番号、選択肢の ID は反映のときに自動で作る。

```yaml
- key: REQUEST_COULD_YOU          # 一度決めたら変えない。記録との対応に使う
  form: "Could you {verb_phrase}?"
  meaning: 相手に丁寧に行動を依頼する
  kind: pattern                   # pattern か atomic_chunk
  example:
    en: Could you send me the file?
    ja: ファイルを送ってもらえますか？
  quiz:
    meaning:                      # 英文を見て意味を選ぶ。正解は example.ja
      near: [ファイルを送ってもいいですか？, ファイルを送りましたか？, ファイルを送るつもりですか？]
    intent:                       # 用途から形を選ぶ
      correct: "Could you ...?"
      near: ["Could I ...?", "Would you like to ...?", "Did you ...?"]
    form:                         # 日本語を見て英文を選ぶ。正解は example.en
      near: [Could I send you the file?, Did you send me the file?, Would you like to send me the file?]
  status: active                  # active か retired。消さずに止める
```

- `quiz` は省略できる。省略した種類のクイズは作らない。
- 混同ペアは `label_a` / `label_b`、`skill_key_a` / `skill_key_b`、`key_a` / `direction_a`、`key_b` / `direction_b`、`type`、`status` を書く。

実装で決めた書き方（2026-10-13。`data/README.md` が正本）:

- 表現には上のほかに `code`（`P1-025` など。練習問題の番号）、`intent`、`tier`（`CORE` / `TIER1`）、`contrast_drill`、`extra_examples` を書く。練習問題の種類は、参照元の migration と同じ規則で `tier`・`kind`・`contrast_drill` から決まる（8 種全部ができるのは `CORE` の `pattern` で `contrast_drill: true` のとき）。
- 規則から外れていた行は 2 種類だけだった。`REQUEST_COULD_YOU` の旧問題 `REQ-001`〜`003` と、`FREEZE_2` の `CANDIDATE-2-CR` である。どちらも `extra_examples` に書く（owner 決定）。
- `CHUNK_GET_HOME` と `CHUNK_HAVE_BREAKFAST` は、クイズの日本語が例文と違う。`quiz.meaning.correct` と `quiz.form.prompt` で別に書ける。
- 混同ペアは `a: {label, skill_key, key, direction}`、`b: {…}`、`type`、`probes`（確認問題。`side` は `a` / `b`）で書く。`confusion_pairs` には `status` の欄が無いので、止める機能は作らない（owner 決定）。

### 3. コマンド

`package.json` に 3 つ足す。

| コマンド | すること |
|---|---|
| `npm run data:check` | YAML の検査だけ。DB に触らない。`key` の重複、カテゴリ、`kind`、例文の `{}` 残り、クイズの誤答が 3 つで正解と重ならないこと、混同ペアの表現 `key` が実在することを見る。間違いは「ファイル名:行 何が悪いか」で出す |
| `npm run data:sync` | 既定は確認だけ。DB との差分を「追加 N 件、変更 N 件、停止 N 件」と、その中身で出す |
| `npm run data:sync -- --apply` | 差分を `speak_kit` に 1 トランザクションで反映する |
| `npm run data:export` | 今の DB の教材を YAML に書き出す。最初の移行と、画面から増えた教材を YAML に取り込むときに使う |

### 4. 反映のルール

- `key` で突き合わせる。YAML にあって DB に無ければ追加、両方にあって中身が違えば変更。
- 行を消さない。YAML から消えた表現や `status: retired` の表現は、DB 側を `status = 'retired'` にする。学習記録は残り、練習とクイズには出なくなる。
- 練習問題の文が変わったら、上書きせず `exercise_definitions` の新しい版を足し、古い版を retired にする。変化は中身（問題文、答え、採点の設定、難しさ）を比べて判定する。既存の行の `content_hash` は参照元の式で作られていて新しい版と式が違うため、判定には使わない。
- クイズの選択肢が変わったら、`quiz_items` の `option_set_version` を上げる。選択肢の ID は、既存の行に合わせて位置（正解、誤答 1〜3）から決まる値にする。
- 混同ペアは教材の欄だけを更新する。`confusion_count`、`success_streak`、`next_due_at` などの学習の状態の欄には触らない。`source = catalog` の行だけを対象にする。確認問題は足せるが、文の書き換えと削除は反映を止める（回答の記録が指しているため）。YAML から教材のペアが消えた場合も止める。
- 採点契約 `assessment_contracts` と問題の実体 `exercises` は、参照元の migration（`20261012000000_skill_trainer_assessment_core.sql`）と同じ規則で作る。
- 適用先が `speak_kit` でなければ止まる（`src/lib/db.mjs` と同じ検査）。

### 5. 最初の移行

1. `data:export` で、今の 51 表現・34 ペアを YAML に書き出す。
2. 書き出した YAML をそのまま `data:sync` して、差分が 0 件になることを確かめる。これで YAML と DB が一致したことになる。
3. YAML で `FREEZE_2` を `retired` にして反映する（owner の判断どおり）。→ 着手時点ですでに DB で retired だったので、書き出した YAML も `status: retired` になっている。反映は不要だった。

### 6. 画面から増える教材との関係

YAML を教材の正本にする。画面から増えた教材（候補の承認、混同ペアの登録、誤答からの検知）は今までどおり DB に入る。`data:export` で YAML に取り込めるようにする。`data:sync` は、YAML に無いこれらの行を停止しない（`source` で見分ける）。

表現では `skill_concepts.review_source` が `owner candidate review` で始まる行を、画面から増えた表現として見分ける。YAML から足した表現は `review_source = 'data/yaml'` で入る。

### 7. ドキュメント

- `data/README.md`: 表現の足し方・直し方・止め方を、例とコマンドつきで書く。
- `README.md`: 「教材は `data/` の YAML で管理する」と、`data:check` → `data:sync` → `data:sync -- --apply` の手順を書く。

## Non-scope

- 教材を編集する画面。今回は YAML とコマンドだけにする。
- 参照元からコピーした 28 本の migration の書き換え。
- 学習記録（回答、証拠、診断）を YAML にすること。記録は DB に置く。
- 練習問題の文の型（前置きの文）を YAML で変えられるようにすること。
- Vercel や Supabase への反映。

## Skeleton

プログラムは `src/` 配下に置く（`05_done/2026-10-13-move-code-under-src.md` で移動済み）。

```text
data/                          # 教材（owner が編集する）
src/lib/content/schema.mjs     # YAML の検査
src/lib/content/derive.mjs     # 表現 1 件 → 練習問題 8 種、クイズ 3 種、採点契約
src/lib/content/sync.mjs       # DB との差分と反映
src/lib/content/export.mjs     # DB → YAML
src/cli/data.mjs               # npm run data:* の入口
src/test/content.test.mjs
```

## Plan

1. 着手前に `git status` を見る。進行中のタスクの未コミットの変更と衝突しないようにする。
2. 依存に `yaml` パッケージを足す。
3. `derive.mjs` を書き、今の DB の `REQUEST_COULD_YOU` を入力にして、DB にある練習問題 8 種とクイズ 3 種と同じ中身が出ることをテストで確かめる。全 51 表現で同じ確認をする。
4. `export.mjs` で YAML を書き出し、`schema.mjs` で検査が通ることを確かめる。
5. `sync.mjs` を書き、Scope 5 の差分 0 件を確かめる。
6. 追加・変更・停止を 1 件ずつ試す（試験用の表現を足す、例文を直す、retired にする）。それぞれ、練習・クイズの画面と DB の行で確かめる。既存の学習記録の件数が変わらないことも見る。
7. `data/README.md` と `README.md` を書く。
8. Acceptance Criteria を観測し、Evidence に残す。

## Acceptance Criteria

- `data/expressions/*.yaml` に 51 表現、`data/confusion_pairs.yaml` に `catalog` の混同ペアがある。
- 何も変えずに `npm run data:sync` を実行すると、差分 0 件と出る。
- YAML に新しい表現を 1 件書いて `data:sync -- --apply` すると、練習問題 8 種とクイズ（書いた種類だけ）ができる。練習画面とクイズ画面に出る。
- 例文を直して反映すると、練習問題に新しい版ができ、古い版は retired になる。それまでの回答の記録は古い版を指したまま残る。
- `status: retired` にして反映すると、練習とクイズに出なくなる。学習記録の件数は変わらない。
- 混同ペアの説明を直して反映しても、`success_streak` と `next_due_at` は変わらない。
- YAML の書き間違い（`key` の重複、誤答が 2 つ、存在しない `key` を指す混同ペア）は `data:check` が「ファイル名:行」つきで止める。DB は変わらない。
- `npm test` が全件通る。

## Owner-only Decisions

- `03_active/` へ移す承認
- `FREEZE_2`（パターン `x`）を retired にするか
- 画面から増えた教材の扱い。提案は Scope 6（DB に入れ、`data:export` で YAML に取り込む）。画面からの追加をやめて YAML だけにする案もある。
- `src/` への移動タスク、設定画面のタスクとの順序。提案は「`src/` への移動 → このタスク → 設定画面」。

## Stop / Ask Owner If

- 書き込み先が `speak_kit` 以外である
- 今の DB の練習問題やクイズが、表現 1 件からの決まった規則で作れていない（例外の行がある）。その行を YAML にどう書くかを相談する
- 反映で学習記録の件数が 1 件でも変わる

## Evidence Required

- 最初の移行での差分 0 件の出力
- 追加・変更・停止それぞれの、`data:sync` の差分の出力と DB の行
- 反映前後の学習記録の件数
- `npm test` の出力

## Evidence

2026-10-13 に観測した。追加・変更・停止の試験は、本物の `speak_kit` を `pg_dump` で写した練習用 DB（ポート 5544、試験後に削除）で行った。本物の `speak_kit` へは書き出し（読むだけ）と差分の確認だけを行い、反映はしていない。

### 最初の移行（本物の `speak_kit`）

```text
$ npm run data:export
  data/expressions/output.yaml: 11 件 / query.yaml: 8 件 / time.yaml: 5 件 / action.yaml: 24 件 / error_handling.yaml: 3 件
  data/confusion_pairs.yaml: 34 件
$ npm run data:check
書き間違いはありません（表現 51 件、混同ペア 34 件）
$ npm run data:sync
反映先: localhost:5432/speak_kit
追加 0 件 / 変更 0 件 / 停止 0 件
```

最初の差分は 0 件ではなく 4 件だった（`CHUNK_GET_HOME` と `CHUNK_HAVE_BREAKFAST` のクイズの日本語が例文と違う）。`quiz.meaning.correct` / `quiz.form.prompt` を足して 0 件にした。

### 追加（練習用 DB）

試験用の表現 `TEST_GRAB_COFFEE`（`CORE`、`pattern`、`contrast_drill: true`、意味と文のクイズ）と、混同ペア 1 組（確認問題 2 問、クイズ 1 問）を書いた。

- `data:sync`: 追加 15 件（表現 1、練習問題 `P1-090-CR` `RG` `SR` `CD` `FP` `RT-1D` `RT-7D` `RT-30D`、クイズ `QZ-ME-` `QZ-FO-TEST_GRAB_COFFEE`、ペア 1、確認問題 2、クイズ `QZ-CS-T001`）。
- 最初の反映は、意味の欄の `〜` が DB の決まり（穴埋めの残りを禁止）に当たって失敗し、全部取り消された。`data:check` に同じ判定を足し、反映の前に「`action.yaml:577 練習問題 P1-090-FP の文「…〜と軽くコーヒーを飲む」に 〜 … が残っています`」と止まるようにした。
- 意味を直して反映: 練習問題 8 行がすべて版 1・active、クイズ 3 行が active で、問題の実体 `exercise_id` も付いた。反映直後の `data:sync` は差分 0 件。
- 画面と同じ処理（`dispatch`）で確認: 自由練習の 5 種（CR、RG、SR、CD、FP）で `P1-090-*` が出た（記憶確認 RT は自由練習ではなく今日の計画から出る）。クイズは、出た問題に正解し続けると `QZ-ME-` `QZ-FO-TEST_GRAB_COFFEE` と `QZ-CS-T001` が出た。

### 変更（練習用 DB）

例文の日本語を「ケンと軽くコーヒーを飲もう。」→「ケンとちょっとコーヒーでも飲もう。」に変えた。

- `data:sync`: 変更 9 件。例文を使う練習問題 7 つ（CR、RG、SR、CD、RT×3）とクイズ 2 問が版 2 になる。
- 反映後: 7 つの練習問題は版 1 が retired、版 2 が active。例文を使わない `P1-090-FP` は版 1 のまま。`QZ-ME-` `QZ-FO-` は選択肢の版 1 が retired、版 2 が active。

### 停止（練習用 DB）

`status: retired` にした。

- `data:sync`: 停止 11 件（表現 1、練習問題 8、クイズ 2）。
- 反映後: 表現 retired、練習問題 15 行（版 1・版 2）がすべて retired、active な `TEST_GRAB_COFFEE` のクイズ 0 行。自由練習で `skill_key: TEST_GRAB_COFFEE` を指定しても別の表現（`P1-006-CR` など）が出て、記録画面の表現数は 51 → 50。

### 混同ペアの説明（練習用 DB）

教材のペア `Did you ...? / Have you ever ...?` に練習用 DB の中だけで学習の状態（取り違え 2、採点 5、正解 3、連続正解 2、残り `["b"]`、次の復習日 2026-10-20 09:00）を入れ、`a.key` と `a.direction` を書き換えて反映した。

```text
[変更] 混同ペア Did you ...? / Have you ever ...?: key_a: "その時した？" → "あの時した？" / direction_a: "特定の過去" → "過去のある一点"
反映後: あの時した？|過去のある一点|2|5|3|2|["b"]||2026-10-20 09:00:00+09
```

確認問題の文の書き換えと削除は「反映できない変更が 2 件あります」と止まり（終了コード 1）、DB は変わらなかった。画面から登録したペア `borrow a book / lend a book` と、候補から足した表現 `FREEZE_2` を YAML から消すと、止めずに「そのままにします（`data:export` で取り込めます）」の案内だけが出た。

### 書き間違い

`key` の重複、誤答 2 つ、存在しない表現を指す混同ペアを入れた写しを検査した。

```text
YAML に 3 件の書き間違いがあります（DB は変えていません）:
  sk-bad/expressions/action.yaml:577 key「CHUNK_GET_HOME」が重複しています（sk-bad/expressions/action.yaml:156 にもあります）
  sk-bad/expressions/action.yaml:577 quiz.form の near（誤答）はちょうど 3 つ書いてください
  sk-bad/confusion_pairs.yaml:1697 a.skill_key「NO_SUCH_SKILL」という表現がありません
```

`data:sync -- --apply` も同じ内容で止まり（終了コード 1）、DB に行は増えなかった。

### 学習記録の件数

- 反映のたびに、7 つの表（回答 `training_attempts`、`quiz_attempts`、証拠、採点の観測、弱点の診断、混同の記録、会話）の件数を反映の前後で比べ、変わったら取り消す。練習用 DB での反映 5 回はすべて「件数は変わっていません」だった。
- 本物の `speak_kit`: 試験の後も `training_attempts` 65、`quiz_attempts` 31。教材も表現 51、練習問題 325、クイズ 257、混同ペア 34 のまま。試験後に書き出し直した `data/` は、試験前に退避した内容と `diff -r` で一致した。

### テスト

`npm test`（練習用 DB、キー無し）: 17 件中 17 件が通った。新しい `src/test/content.test.mjs` の 9 件は DB を使わない。練習問題の種類の規則、既存の行と同じ選択肢 ID、穴埋めの判定、書き間違いの「ファイル名:行」を見る。コアのファイルが AI クライアントを読まない検査も通っている。

### 残る制限

- アプリは、誤答から混同を検知すると、教材のペアの `source` を `observed_mistake` に書き換える（`because / that's why` は書き換わっている）。書き換わったペアは画面から増えたものとして扱うので、YAML で説明を直しても反映されず、お知らせだけが出る。教材の欄と学習の状態の欄を分ける話は、`02_backlog/2026-10-13-architecture-refactor-db-first.md` の DB の作り直しで扱う。

### 作業中に起きたこと

練習用 DB につないだ画面サーバーを、同じフォルダで 3001 番に一瞬立てたところ、3000 番のサーバーと作業用フォルダ `.next` を取り合って 3000 番が 500 を返した。すべて止めて `.next` を消し、3000 番を前と同じ設定（Anthropic キーだけを渡し、本物の DB）で立て直した。画面 200、`/api/ai/status` は `{"aiEnabled":true}`。画面の確認は、サーバーを立てずに同じ処理を直接呼ぶ形に変えた。
