import { join, relative } from "node:path"
import { config } from "../server/config.mjs"
import { loadContent } from "../server/content/schema.mjs"

const ROOT = config.root
const DATA_DIR = config.dataDir
const [command, ...args] = process.argv.slice(2)

function check() {
  const content = loadContent(DATA_DIR)
  if (content.errors.length) {
    console.error(`YAML に ${content.errors.length} 件の書き間違いがあります（DB は変えていません）:`)
    for (const error of content.errors) console.error(`  ${error}`)
    return null
  }
  return content
}

function databaseName() {
  const { host, port, name } = config.database
  return `${host}:${port}/${name}`
}

async function sync(apply) {
  const content = check()
  if (!content) return 1
  const { pool, withTransaction } = await import("../server/db.mjs")
  const { planSync, applySync } = await import("../server/content/sync.mjs")
  const { learningCounts } = await import("../server/content/state.mjs")
  try {
    const plan = await planSync(pool, content)
    console.log(`反映先: ${databaseName()}`)
    const counts = { 追加: 0, 変更: 0, 停止: 0 }
    for (const change of plan.changes) {
      counts[change.kind] += 1
      console.log(`  [${change.kind}] ${change.label}: ${change.detail}`)
    }
    for (const notice of plan.notices) console.log(`  （お知らせ）${notice}`)
    console.log(`追加 ${counts.追加} 件 / 変更 ${counts.変更} 件 / 停止 ${counts.停止} 件`)
    if (plan.blockers.length) {
      console.error(`反映できない変更が ${plan.blockers.length} 件あります:`)
      for (const blocker of plan.blockers) console.error(`  ${blocker}`)
      return 1
    }
    if (!apply) {
      if (plan.changes.length) console.log("まだ DB は変えていません。反映するには npm run data:sync -- --apply")
      return 0
    }
    if (!plan.changes.length) {
      console.log("反映するものはありません")
      return 0
    }
    const before = await learningCounts(pool)
    await withTransaction(async (client) => {
      await applySync(client, plan)
      const after = await learningCounts(client)
      for (const [table, count] of Object.entries(before)) {
        if (after[table] !== count) throw new Error(`学習の記録 ${table} の件数が変わったので取り消しました（${count} → ${after[table]}）`)
      }
    })
    console.log(`反映しました（学習の記録の件数は変わっていません: ${Object.entries(before).map(([table, count]) => `${table} ${count}`).join(", ")}）`)
    return 0
  } finally {
    await pool.end()
  }
}

async function exportData() {
  const { pool } = await import("../server/db.mjs")
  const { exportContent } = await import("../server/content/export.mjs")
  try {
    console.log(`読み出し元: ${databaseName()}`)
    for (const { path, count } of await exportContent(pool, DATA_DIR)) {
      console.log(`  ${relative(ROOT, path)}: ${count} 件`)
    }
    return 0
  } finally {
    await pool.end()
  }
}

async function main() {
  if (command === "check") {
    const content = check()
    if (!content) return 1
    console.log(`書き間違いはありません（表現 ${content.expressions.length} 件、混同ペア ${content.pairs.length} 件）`)
    return 0
  }
  if (command === "sync") return sync(args.includes("--apply"))
  if (command === "export") return exportData()
  console.error("使い方: node src/cli/data.mjs check | sync [--apply] | export")
  return 1
}

process.exitCode = await main().catch((error) => {
  console.error(error.message)
  return 1
})
