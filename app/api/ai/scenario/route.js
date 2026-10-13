import { scenario } from "../../../../lib/ai/features.mjs"

export async function POST() {
  const result = await scenario()
  return Response.json(result)
}
