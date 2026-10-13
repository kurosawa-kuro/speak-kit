import { aiEnabled } from "../../../../lib/ai/isEnabled.mjs"

export function GET() {
  return Response.json({ aiEnabled: aiEnabled() })
}
