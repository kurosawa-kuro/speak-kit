# 02 アーキテクチャ

出典は [英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md](./英会話アプリ-コミュニティ配布を先に作り次段階へコピーする.md)。製品の形は確定している。アプリ本体は未着手で、ディレクトリの切り方は着手時に決める。

着手順は、先にローカルで Golden Path を通すことである。Vercel、①用 Supabase、配布用 GitHub は別ステップである。詳細は [04_workflows.md](./04_workflows.md) と [08_release_runbook.md](./08_release_runbook.md)。

## 概要

```text
ブラウザ（Next.js）
  -> コア API Routes（フレーズ、録音比較、学習記録）
  -> 学習記録の保存先

ブラウザ
  -> AI API Routes（任意。コアとは別エンドポイント）
  -> サーバー側 proxy
  -> Claude API
```

コアの経路は AI クライアントを import しない。AI の失敗はコアの経路へ入らない。

## 構成要素

| 構成要素 | 役割 | 状態 |
|---|---|---|
| Next.js（React） | 画面。音声入出力の実装方法は未決 | 未着手 |
| Next.js API Routes（コア） | 読み上げ練習、録音比較、学習記録・お気に入り | 未着手。AI クライアントを import しない |
| Next.js API Routes（AI） | 自由対話、文法／自然さフィードバック、シナリオ生成 | 任意。コアのあと |
| `lib/ai/isEnabled.ts`（例） | `hasAnthropicKey` の単一算出点。サーバーは `aiEnabled: boolean` だけを返す | パスは着手時。算出点は 1 箇所 |
| `lib/ai/client.ts`（例） | キーが無いときは `null` | 同上 |
| Supabase（Auth + Postgres） | 配布後の認証と学習記録 | 製品の保存先。①用 project は未所持。クラウド手順 |
| Vercel | 配布先のデプロイ | 別ステップ |
| Claude API | 任意の LLM。クライアントにキーを渡さない | 未設定が既定 |
| エージェントガイド | Codex / 他エージェント向けの repo ガイド | `AGENTS.md` |
| Claude ガイド | Claude Code の司令ルール | `CLAUDE.md` |
| タスク文書 | 一回性の作業計画・実装タスク | `docs/tasks/` |
| Claude skills | Claude Code で繰り返し使う作業手順 | `.claude/skills/` |

実装基盤にしないもの: 本番 `skill-trainer` の適応訓練エンジン、Retool、ローカル Postgres。private-ops の個人運用ルールは、この公開配布アプリへそのまま適用しない。

## Golden Path とアーキテクチャ

要件の Critical User Journey は [01_requirements.md](./01_requirements.md)。AI を単一障害点にしない。

| Golden Path ステップ | 通る構成要素 | 通る境界 / データ | 単一障害点（切れると journey が止まる） |
|---|---|---|---|
| 1. AI キー無しで開く | Next.js UI、`aiEnabled` の算出 | キーはサーバー側だけ。クライアントへは boolean | キー未設定を例外として落とすこと |
| 2. フレーズを読み上げる | UI とコア API。音声の実装は未決 | コア経路。AI route を呼ばない | 音声実装が未決のまま手順を固定すること |
| 3. 録音して比べる | UI とコア API | コア経路。AI の timeout を待たない | AI 呼び出しをこの応答に直列で置くこと |
| 4. 学習記録を残す | コア API と保存先 | 製品の保存先は Supabase。ローカル先行の保存先は未決 | live の学習者データベース。①用 Supabase は未所持 |

- 新しい依存を足すときは、この表の Golden Path 上に AI・Vercel・Cloudflare を単一障害点として置かない。
- Golden Path 上の構成要素の変更は、[08_release_runbook.md](./08_release_runbook.md) の smoke と整合させる。

## 境界

- LLM 呼び出しはサーバー側 proxy のみ。クライアントに API キーを渡さない。
- コア機能の API route は AI クライアントを import しない。AI 機能は別エンドポイントに隔離する。
- キー有無は 1 箇所だけを参照する。クライアントにキーの有無を直接晒さない。
- AI 呼び出しは try/catch に置く。失敗時は構造化エラーを返し、プロセスとリクエストは落とさない。
- UI は Error Boundary で AI セクションを囲む。粒度（機能ごとか、セクション全体か）は未決。
- `aiEnabled` を起動時に固定するか、リクエストごとに再評価するかは未決。
- 配布は各自の GitHub・Vercel・Supabase・任意の Anthropic キー。黒澤名義の鍵に相手の利用量を載せない。
- 非機密の設定は `env/config.yaml`。ローカル秘密情報は `env/secret.yaml`（コミットしない）。
- Doppler `apps/dev` からローカル準備に使ってよい鍵は [05_data_model.md](./05_data_model.md) の名前だけである。`apps/dev` をプロセスへ丸ごと注入しない。
- Codex が `.claude/rules/` や `.claude/skills/` を読む前提にしない。Codex / 他エージェント向けに永続させたい指針は `AGENTS.md` に置く。

## 配布とデプロイの判断

各自が自分の GitHub で clone または fork し、自分の Vercel、自分の Supabase、自分の Anthropic API キーでデプロイする。クオータ制限は置かない。手数を減らす手段は「Deploy with Vercel」と GitHub テンプレートリポジトリ化である。テンプレート化の範囲は未決。

この用途では Vercel を採る。Next.js の一次対応であり、GitHub 連携、env、ビルドまでを一つの手順にできる。Cloudflare（Pages / Workers）は、Next.js にアダプタと Edge runtime の制約が入り、動画の手順がずれやすい。Cloudflare を検討するのは、将来 Next.js 以外へ変える場合か、音声処理を Workers 側へ持たせる場合である。Doppler にある Cloudflare の鍵は、このアプリのデプロイには使わない。

## 関連タスク

- 構造変更、責務移動、adapter 追加、共通化は、実装前に `docs/tasks/03_active/` へ task を作る。
- 中規模以上の変更では、task に Skeleton / Plan / Acceptance Criteria を書いてから実装する。
- 確定した設計判断は task から `docs/adr/` またはこの文書へ昇格する。
