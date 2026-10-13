import { createHash } from "node:crypto"

export function hashParts(parts) {
  const hasher = createHash("sha256")
  for (const part of parts) {
    hasher.update(String(part))
    hasher.update(Buffer.from([0x1f]))
  }
  return hasher.digest("hex")
}
