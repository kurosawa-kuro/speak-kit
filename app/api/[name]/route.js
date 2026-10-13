import { dispatch } from "../../../lib/dispatch.mjs"

export async function POST(request, context) {
  const { name } = await context.params
  const body = await request.json().catch(() => ({}))
  const result = await dispatch(name, body)
  if (result === null) {
    return Response.json({ ok: false, code: "not_found", data: {}, error: { message: "unknown rpc" } }, { status: 404 })
  }
  return Response.json(result)
}
