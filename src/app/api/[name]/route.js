import { after } from "next/server"
import { dispatch } from "../../../server/dispatch.mjs"
import { envelope } from "../../../server/http/envelope.mjs"
import { logError } from "../../../server/http/errors.mjs"

export const dynamic = "force-dynamic"

const STATUS = { validation_error: 400, not_found: 404 }

export async function POST(request, context) {
  const { name } = await context.params
  const body = await request.json().catch(() => ({}))
  try {
    const result = await dispatch(name, body, { defer: (task) => after(task) })
    if (result === null) {
      return Response.json(envelope(false, "not_found", {}, { message: "unknown rpc" }), { status: 404 })
    }
    return Response.json(result, { status: STATUS[result.code] ?? 200 })
  } catch (error) {
    await logError(`rpc ${name}`, error)
    return Response.json(envelope(false, "internal_error", {}, { message: "server error" }), { status: 500 })
  }
}
