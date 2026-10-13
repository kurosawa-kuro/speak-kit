import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// 環境変数を読むのはこのファイルだけ。CLI・テスト・設定画面の「起動時の設定」もここから読む。
// 例外は src/middleware.js（Edge で動くので、このファイルを import できない）。

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DEFAULT_DATABASE_URL = "postgresql://kurosawa@localhost:5432/speak_kit"
const LOCAL_DATABASES = ["speak_kit", "speak_kit_test"]

function databaseConfig() {
  const url = process.env.SPEAK_KIT_DATABASE_URL || DEFAULT_DATABASE_URL
  const parsed = new URL(url)
  const name = parsed.pathname.replace(/^\//, "")
  const kind = process.env.SPEAK_KIT_DATABASE_KIND || "local"
  if (kind === "local") {
    if (!LOCAL_DATABASES.includes(name)) {
      throw new Error(`speak-kit database must be ${LOCAL_DATABASES.join(" or ")}, got ${name || "(none)"}`)
    }
  } else if (kind === "supabase") {
    if (name !== "postgres" || !/\.supabase\.(com|co)$/.test(parsed.hostname)) {
      throw new Error(`supabase database must be postgres on a supabase host, got ${name || "(none)"} on ${parsed.hostname}`)
    }
  } else {
    throw new Error(`SPEAK_KIT_DATABASE_KIND must be local or supabase, got ${kind}`)
  }
  return {
    url,
    name,
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    kind,
    // Supabase の接続プーラーの証明書は公開の認証局で検証できないので、暗号化だけを求める。
    ssl: kind === "supabase" ? { rejectUnauthorized: false } : undefined,
    // Vercel の関数は数が増えるので、1 つあたりの接続を少なくする。
    poolMax: Number(process.env.SPEAK_KIT_DATABASE_POOL_MAX || (kind === "supabase" ? 3 : 10)),
  }
}

export const config = Object.freeze({
  root: ROOT,
  dataDir: process.env.SPEAK_KIT_DATA_DIR || join(ROOT, "data"),
  // Vercel ではファイルに書けないので、関数のログ（console）だけに残す。
  errorLog: process.env.VERCEL ? null : process.env.SPEAK_KIT_ERROR_LOG || join(ROOT, "logs", "server-errors.log"),
  learnerKey: "default",
  domainCode: "english_conversation",
  timeZone: "Asia/Tokyo",
  login: process.env.SPEAK_KIT_PASSWORD ? "password" : "disabled",
  database: databaseConfig(),
  ai: Object.freeze({
    url: "https://api.anthropic.com/v1/messages",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    timeoutMs: 20000,
    maxTokens: 600,
    // 1M トークンあたりのドル（2026-10-07 の公開価格）。表にないモデルは、いちばん高い値で数える。
    pricesPerMTok: Object.freeze({
      "claude-sonnet-5": { input: 2, output: 10 },
    }),
    fallbackPricePerMTok: { input: 15, output: 75 },
    dailyLimitUsd: 2,
    // 画面に円で出すときの目安のレート（1 ドルあたりの円）。
    usdJpy: Number(process.env.SPEAK_KIT_USD_JPY || 150),
    monthlyLimitUsd: 20,
  }),
})

/** キーは画面から変えられるようにせず、毎回ここから読む（テストで差し替えるため）。値は外に出さない。 */
export function anthropicKey() {
  const key = process.env.ANTHROPIC_API_KEY
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null
}

/** 設定画面に出す、起動時に決まる設定。接続文字列とパスワードは返さない。 */
export function startupSettings() {
  return {
    login: config.login,
    database: { kind: config.database.kind, name: config.database.name, host: config.database.host },
    ai: {
      model: config.ai.model,
      dailyLimitUsd: config.ai.dailyLimitUsd,
      monthlyLimitUsd: config.ai.monthlyLimitUsd,
    },
  }
}
