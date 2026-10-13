/** RPC を呼ぶ。HTTP の状態が 4xx/5xx でも、本文の envelope（ok・code・data・error）を返す。 */
export async function post(name, body) {
  const response = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  })
  const envelope = await response.json().catch(() => null)
  if (envelope && typeof envelope.ok === "boolean") return envelope
  return { ok: false, code: `http_${response.status}`, data: {}, error: { message: "" } }
}
