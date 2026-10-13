import { pool } from "../server/db.mjs"

/** DB に書くテストは最初にこれを import する。speak_kit_test 以外なら、何も書かずに止まる。 */
const { rows } = await pool.query("SELECT current_database() AS name")
if (rows[0].name !== "speak_kit_test") {
  await pool.end()
  throw new Error(`テストは speak_kit_test でだけ動かす（今の接続先: ${rows[0].name}）。npm test で実行すること`)
}

export { pool }
