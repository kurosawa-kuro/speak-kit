export function aiEnabled() {
  const key = process.env.ANTHROPIC_API_KEY
  return typeof key === "string" && key.trim().length > 0
}
