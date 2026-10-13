import { checkPassword } from "./server/http/guard.mjs"

export function middleware(request) {
  const result = checkPassword(request.headers.get("authorization"), {
    password: process.env.SPEAK_KIT_PASSWORD,
    onVercel: Boolean(process.env.VERCEL),
  })
  if (result === "allow") return
  if (result === "misconfigured") {
    return new Response("SPEAK_KIT_PASSWORD is not set", { status: 503 })
  }
  return new Response("password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="speak-kit", charset="UTF-8"' },
  })
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
