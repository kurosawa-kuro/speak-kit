import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { config } from "../config.mjs"

/** 想定外のエラーを 1 行ずつ残す。書けなくても本体の応答は止めない。 */
export async function logError(where, error) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    where,
    message: error?.message ?? String(error),
    stack: error?.stack?.split("\n").slice(0, 6).join("\n"),
  })
  console.error(`[speak-kit] ${where}: ${error?.message ?? error}`)
  if (!config.errorLog) return
  try {
    await mkdir(dirname(config.errorLog), { recursive: true })
    await appendFile(config.errorLog, `${line}\n`)
  } catch {
    // ログが書けないときは console だけに残す
  }
}
