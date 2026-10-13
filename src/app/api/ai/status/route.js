import { aiStatus } from "../../../../lib/ai/isEnabled.mjs"

export const dynamic = "force-dynamic"

export async function GET() {
  const { aiEnabled, keyConfigured, setting, reason } = await aiStatus()
  return Response.json({ aiEnabled, keyConfigured, setting, reason })
}
