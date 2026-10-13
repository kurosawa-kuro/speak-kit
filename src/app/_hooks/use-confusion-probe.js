"use client"

import { useCallback, useRef, useState } from "react"

/** 次に出す混同ペアの確認問題。一度答えた確認問題は、この画面の間はもう出さない。 */
export function useConfusionProbe() {
  const [override, setOverride] = useState(null)
  const answered = useRef(new Set())

  const offer = useCallback((probe) => {
    if (!probe?.probeId || answered.current.has(probe.probeId)) return false
    setOverride({ probeId: probe.probeId, prompt: probe.prompt, expectedReference: probe.expectedReference })
    return true
  }, [])
  const markAnswered = useCallback((probeId) => answered.current.add(probeId), [])
  const isAnswered = useCallback((probeId) => answered.current.has(probeId), [])
  const clear = useCallback(() => setOverride(null), [])
  return { override, offer, markAnswered, isAnswered, clear }
}
