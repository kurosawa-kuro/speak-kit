# ADR 0001: 実行環境は Vercel、DB は Supabase のままにする（Cloudflare へは移さない）

- 日付: 2026-10-13
- 状態: 採用（owner 判断「一旦いまのまま」）

## 背景

2026-10-13 に、自分用のクラウドを Vercel（東京 `hnd1`）と Supabase（東京 `ap-northeast-1`）に立てた（[tasks/05_done/クラウドインフラ対応.md](../tasks/05_done/クラウドインフラ対応.md)）。

役割の分担は次のとおりである。

| 役割 | 担当 |
|---|---|
| 画面と API を守る | アプリの Basic 認証（`src/middleware.js`）。合言葉は Vercel の環境変数 `SPEAK_KIT_PASSWORD` |
| アプリを動かす | Vercel |
| データを保存する | Supabase の Postgres |
| ログイン機能（アカウント） | 使っていない。Supabase Auth も使っていない |

owner から「認証を Cloudflare にし、Cloudflare の DB を使えば Vercel を不要にできたのでは」と問いがあった。

## 検討した案

### 認証を Cloudflare Access にする

- Cloudflare Access（Zero Trust）は 50 人まで無料である。
- メールに届くコードでのログインなどができ、今の Basic 認証より守りが強い。
- 良い選択肢である。

### DB を Cloudflare D1 にする

- D1 は SQLite で、今の DB は Postgres である。DB の形の SQL（baseline 2,228 行）とサービスの SQL を、ほぼすべて書き直すことになる。
- 次の Postgres 専用の機能を使っている。
  - 行のロック（`FOR UPDATE`）
  - 日本時間の日付の計算（`AT TIME ZONE 'Asia/Tokyo'`）
  - DB の中の関数（plpgsql）
  - アドバイザリロック（同時に来た処理の順番を決めるロック）
- 2026-10-13 の DB の作り直しを、もう一度するのに近い作業量になる。
- 割に合わない。

### Vercel を外す現実的な形

- アプリを Cloudflare Workers で動かす。Next.js は OpenNext（変換の仕組み）を通す。
- DB は Supabase の Postgres のままにし、Hyperdrive（Cloudflare から Postgres への接続を中継する仕組み）でつなぐ。
- 認証は Cloudflare Access にする。
- これで Vercel は不要になる。Supabase は DB として残る。

### Vercel のまま、前に Cloudflare Access を置く

- 守りだけを強くできる。
- 独自ドメインを Cloudflare で管理する必要がある。

## 決定

一旦いまのまま（Vercel + Supabase + Basic 認証）とする。

理由:

- **すでに動いている。** Vercel 版は 2026-10-13 に本番で全部の流れ（今日の計画、クイズ、記録、AI の採点）を確かめた。
- **Next.js との相性。** OpenNext を通すと、回答後の採点（`after()`）のような Next.js の機能が Cloudflare の上で同じに動くかを確かめ直す必要がある。
- **これまでの判断と合う。** [02_architecture.md](../02_architecture.md) の「配布とデプロイの判断」で Vercel を採っている。知人への配り方も「Deploy with Vercel」を前提にしている。
- **鍵の決まり。** Doppler にある Cloudflare の鍵（`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`）は、このアプリには使わない決まりである。

## 見直すとき

次のどれかが起きたら、この ADR を見直す。

- 守りを強くしたくなった。第一候補は Cloudflare Access（Vercel のまま前に置くか、Workers に移すか）。
- Vercel の無料枠や制約（関数の実行時間など）で困った。第一候補は Cloudflare Workers + Hyperdrive + Supabase。
- D1 への移行は、DB を全部書き直す覚悟があるときだけ検討する。

Cloudflare の鍵を使う場合は、先に owner が鍵の決まりを変える。
