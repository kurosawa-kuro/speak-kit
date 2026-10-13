// Edge の middleware から呼ぶので、node: のモジュールと config.mjs を import しない。

/**
 * 合言葉（Basic 認証のパスワード）で守る。ユーザー名は見ない。
 * Vercel の上で合言葉が未設定なら、誰にも開かない。
 * @returns {"allow"|"challenge"|"misconfigured"}
 */
export function checkPassword(authorization, { password, onVercel }) {
  if (!password) return onVercel ? "misconfigured" : "allow"
  const [scheme, encoded] = String(authorization || "").split(" ")
  if (scheme !== "Basic" || !encoded) return "challenge"
  let decoded
  try {
    decoded = atob(encoded)
  } catch {
    return "challenge"
  }
  const given = decoded.slice(decoded.indexOf(":") + 1)
  return sameText(given, password) ? "allow" : "challenge"
}

function sameText(a, b) {
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i += 1) diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i)
  return diff === 0
}
