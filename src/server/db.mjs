import pg from "pg"
import { config } from "./config.mjs"

const { Pool } = pg

export const pool = new Pool({
  connectionString: config.database.url,
  ssl: config.database.ssl,
  max: config.database.poolMax,
})

export async function query(text, params) {
  return pool.query(text, params)
}

export async function withTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
