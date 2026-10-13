import { aiStatus } from "../../../lib/ai/isEnabled.mjs"
import { getSettings, saveSettings, startupSettings } from "../../../lib/settings.mjs"

export const dynamic = "force-dynamic"

async function view() {
  const settings = await getSettings()
  const { aiEnabled, keyConfigured, reason } = await aiStatus()
  return {
    ok: true,
    code: "ok",
    data: {
      settings: { aiEnabled: settings.aiEnabled, updatedAt: settings.updatedAt },
      ai: { aiEnabled, keyConfigured, reason },
      startup: startupSettings(),
    },
    error: null,
  }
}

export async function GET() {
  return Response.json(await view())
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  if (typeof body?.ai_enabled !== "boolean") {
    return Response.json(
      { ok: false, code: "validation_error", data: {}, error: { message: "ai_enabled must be true or false" } },
      { status: 400 },
    )
  }
  await saveSettings({ aiEnabled: body.ai_enabled })
  return Response.json(await view())
}
