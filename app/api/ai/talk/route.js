import { talk } from "../../../../lib/ai/features.mjs"

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  const result = await talk(body)
  return Response.json(result)
}
