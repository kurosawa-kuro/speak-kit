# 教材（表現・練習問題・クイズ・混同ペア）

このフォルダの YAML が教材の正本です。ここを書き換えて、コマンドで DB（ローカルの `speak_kit`）へ反映します。SQL を書く必要はありません。

```text
data/
  expressions/            # 表現。カテゴリごとに 1 ファイル（ファイル名がカテゴリになる）
    output.yaml           # OUTPUT
    query.yaml            # QUERY
    time.yaml             # TIME
    action.yaml           # ACTION
    error_handling.yaml   # ERROR_HANDLING
  confusion_pairs.yaml    # 混同ペア（取り違えやすい 2 つの形）と確認問題
```

## 反映の手順

```bash
npm run data:check              # 書き間違いを調べるだけ。DB には触らない
npm run data:sync               # DB と比べて「追加 N 件 / 変更 N 件 / 停止 N 件」と中身を出す。まだ DB は変えない
npm run data:sync -- --apply    # 上の差分を DB へ反映する（全部まとめて 1 回で。途中で失敗したら全部取り消す）
npm run data:export             # 今の DB の教材を YAML に書き出す（画面から増えた教材を取り込むとき）
```

- 書き間違いは「ファイル名:行 何が悪いか」で出ます。直してからもう一度 `data:check` してください。
- 反映の前後で、学習の記録（回答・採点・診断など）の件数が変わったら、反映は取り消されます。
- 反映先は `speak_kit` と、テスト用の `speak_kit_test` だけです。それ以外の DB にはつながりません。
- 空の DB にもそのまま入れられます。`npm test` の準備もこれを使います。

## 表現を足す

ファイルの最後に 1 件書き足します。

```yaml
- key: GRAB_A_COFFEE              # 大文字・数字・_。一度決めたら変えない（記録との対応に使う）
  code: P1-051                    # 練習問題の番号。P1- と数字 3 桁。他と重ならないもの。一度決めたら変えない
  form: grab a coffee with ~      # 形
  meaning: 人と軽くコーヒーを飲む  # 意味
  intent: DAILY_LIFE              # 用途（省略できる）
  tier: CORE                      # CORE（基本）か TIER1
  kind: pattern                   # pattern（型）か atomic_chunk（決まった言い回し）
  contrast_drill: true            # 使い分けの練習も作るとき（省略できる）
  example:
    en: Let's grab a coffee with Ken.
    ja: ケンと軽くコーヒーを飲もう。
  quiz:                           # 省略できる。書いた種類のクイズだけ作る
    meaning:                      # 英文を見て意味を選ぶ。正解は example.ja
      near:                       # まぎらわしい誤答をちょうど 3 つ
        - ケンにコーヒーを買おう。
        - ケンとコーヒーを作ろう。
        - ケンはコーヒーを飲んだ。
    intent:                       # 用途から形を選ぶ
      correct: grab a coffee
      near: [make a coffee, take a coffee, drink coffee]
    form:                         # 日本語を見て英文を選ぶ。正解は example.en
      near:
        - Let's grab coffee to Ken.
        - Let's take a coffee for Ken.
        - Let's grabbing a coffee with Ken.
  status: active                  # active（使う）か retired（止める）
```

`code` を書くと、練習問題が次の決まりで自動でできます。問題文は例文に決まった前置きを付けたもので、答えは例文の英語です。

| 練習 | できる条件 |
|---|---|
| 思い出して答える（CR）、意味を答える（RG）、記憶確認 1日・7日・30日（RT） | いつも |
| 一部を入れ替える（SR） | `kind: pattern` のとき |
| 使い分ける（CD） | `contrast_drill: true` のとき |
| 自分のことを 1 文で（FP） | `tier: CORE` のとき（問題文に `meaning` が入る） |

練習問題の文と答えには、`〜` `...` `…` `{` `}` や「A と B」のような穴埋めを残せません（DB の決まり）。`tier: CORE` だと `meaning` も問題文に入るので、`meaning` にも使えません。

### 例文を別に足す

1 つの表現に、決まった練習とは別の「思い出して答える」問題を足すときは `extra_examples` に書きます。

```yaml
  extra_examples:
    - key: REQ-004                # 大文字・数字・-。他の練習問題と重ならないもの
      en: Could you check this for me?
      ja: これを確認してもらえますか？
      difficulty: 1               # 1〜5。省略すると 2
```

### クイズだけ日本語を変える

意味クイズの正解や、文を選ぶクイズの問題文を、例文の日本語とは別の文にしたいときだけ書きます。

```yaml
  quiz:
    meaning:
      correct: 家に着く           # 省略すると example.ja
      near: [帰る, 家にいる, 家を出る]
    form:
      prompt: 家に着く            # 省略すると example.ja
      near: [go to home, get house, arrive home to]
```

## 表現を直す

YAML の文を書き換えて反映します。

- 例文や意味を変えると、その文を使う練習問題とクイズに新しい版ができ、古い版は止まります。今までの回答の記録は古い版を指したまま残ります。
- `key` と `code` は変えないでください。変えると、別の表現として足され、元の表現は止まります。

## 表現を止める

`status: retired` にして反映します。行は消えず、練習とクイズに出なくなります。学習の記録はそのまま残ります。`active` に戻せば、また出ます。

YAML から表現を消しても止まります。ただし、会話の候補から画面で足した表現（DB の記録で見分けます）は、YAML に無くても止めません。`data:export` で YAML に取り込めます。

## 会話の候補から足した表現

会話のあとに出る候補を承認すると、YAML の表現と同じ形（key・code・form・meaning・tier・kind・example）で DB に入り、YAML と同じ種類の練習問題ができます。code は空いている次の番号（`P1-` と 3 桁）になります。すでにある key へまとめると、その表現の `extra_examples` に `CAND-<候補の番号>` の例文が 1 つ増えます。

承認したら、`npm run data:export` で YAML に取り込み、YAML を正本に戻してください。取り込んだあとは、ほかの表現と同じように YAML で直せます。

## 混同ペア

```yaml
- type: MEANING                   # DIRECTION / TIME / SUBJECT / INTENT / MEANING / REGISTER
  a:
    label: grab a coffee          # a と b は文字の順（a のほうが先）に並べる
    skill_key: GRAB_A_COFFEE      # 対応する表現の key（省略できる）
    key: 軽く飲む                 # その形の短い説明
    direction: 誘う               # 見分ける手がかり
  b:
    label: make a coffee
    key: いれる
    direction: 作る
  probes:                         # 確認問題（どちらの形か答える問題）
    - side: a                     # a.label の側なら a、b.label の側なら b
      prompt: ケンと軽くコーヒーを飲もう。
      answer: Let's grab a coffee with Ken.
      quiz:                       # 4 択クイズにもするとき（省略できる）
        key: QZ-CS-0200           # QZ-CS- で始める。他と重ならないもの
        pair: Let's make a coffee with Ken.   # もう片方の形を使った誤答
        near:                     # ほかの誤答をちょうど 2 つ
          - Let's grab coffee to Ken.
          - Let's take a coffee for Ken.
```

- 新しいペアと確認問題には `id` を書きません（自動で決まります）。書き出した YAML にある `id` は変えないでください。
- 直せるのは説明の欄（`label`、`skill_key`、`key`、`direction`、`type`）と、クイズの選択肢です。取り違えた回数や次の復習日などの学習の状態は DB にあり、反映しても変わりません。
- 確認問題は足せますが、文の書き換えと削除はできません（回答の記録が指しているため）。直したいときは、元の確認問題を残したまま、新しい確認問題を足してください。
- 混同ペアは止められません。YAML から消すと、反映が止まります。
- 画面から登録したペア（`source: learner_registered` が付いたもの）は、YAML から足せますが、すでに DB にあるものの説明は YAML からは変えません。
