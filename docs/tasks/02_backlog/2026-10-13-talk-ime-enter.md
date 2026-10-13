# 会話画面で、日本語入力の変換を確定する Enter で送信しないようにする

## Weight Class

- Class: Light
- Reason: 会話画面の入力欄のキー処理 1 か所を直す。
- Limits: サーバーと DB は変えない。
- Owner approval required: yes。`03_active/` へ移す指示があるまで着手しない。

## Goal

会話画面で日本語を入力し、変換を確定するために Enter を押しても、メッセージが送られないようにする。変換を確定したあとの Enter では、今までどおり送られる。

## Context

- 出どころ: `02_backlog/実運用可能な状況かをレビュー依頼.md` の R6。
- `src/app/screens/talk.js:202-204`:

  ```js
  onKeyDown={(e) => {
    if (e.key === "Enter") handleSend()
  }}
  ```

  変換中かどうか（`e.nativeEvent.isComposing`）を見ていない。
- 書きかけの文が送られると、会話の記録と「言えなかった場面」の判定が、書きかけの文で作られる。日本語の混ざり具合や詰まりの指標も狂う。
- ほかの画面の確認結果:
  - クイズの Enter（`src/app/screens/quiz.js:86-100`）は、入力欄の上では何もしない。影響しない。
  - 混同ペアの登録（`src/app/screens/train.js:428-446`）は、ブラウザ標準のフォーム送信を使う。Chrome は変換中の Enter で送信しない。Safari での挙動は未確認である。
  - 練習の回答欄は `textarea` で、Enter のキー処理は無い。

## Scope

1. `talk.js` の `onKeyDown` で、`e.nativeEvent.isComposing` が true のとき、または `e.keyCode === 229` のときは送信しない。`keyCode === 229` は、Safari で変換確定の Enter を見分けるためである。
2. 混同ペアの登録フォームを、Safari で変換確定の Enter を押して確かめる。送られてしまう場合は、同じ判定を足す。
3. 同じキー処理が今後ほかの入力欄にも要るときのために、判定を `src/app/ui/` の小さな関数（例: `isSubmitEnter(event)`）にしてもよい。足すのは 2 か所以上で使う場合だけにする。

## Non-scope

- 会話画面の「もう一度話す」の不具合（リファクタリング案の A1）
- 入力欄を `textarea` にして、Shift+Enter で改行できるようにすること

## Plan

1. 開発サーバーで会話画面を開き、日本語入力で「こんにちは」と入力する。変換を確定する Enter で送られてしまうことを確かめる（直す前の再現）。
2. Scope 1 を直す。
3. 同じ操作で、変換の確定では送られず、もう一度 Enter を押すと送られることを確かめる。Chrome と Safari の両方で確かめる。
4. 英語だけの入力で、Enter 1 回で送られることを確かめる。
5. Scope 2 を確かめる。

## Acceptance Criteria

- Chrome と Safari で、日本語入力の変換を確定する Enter ではメッセージが送られない。
- 変換を確定したあとの Enter と、英語入力の Enter では、1 回で送られる。
- 送信ボタンの動きは変わらない。
- `npm test` が全件通る。

## Owner-only Decisions

- `03_active/` へ移す承認

## Evidence Required

- 直す前と後の、Chrome と Safari での操作結果
- 会話の記録（`conversation_turns`）に、書きかけの文が入っていないこと
