import pg from "pg"

const { Pool } = pg

function connectionString() {
  const url =
    process.env.SPEAK_KIT_DATABASE_URL ||
    "postgresql://kurosawa@localhost:5432/speak_kit"
  const name = new URL(url).pathname.replace(/^\//, "")
  if (name === "flow" || name === "") {
    throw new Error("speak-kit refuses database flow")
  }
  if (name !== "speak_kit" && name !== "speak_kit_test") {
    throw new Error(`speak-kit database must be speak_kit or speak_kit_test, got ${name}`)
  }
  return url
}

export const pool = new Pool({ connectionString: connectionString() })

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
