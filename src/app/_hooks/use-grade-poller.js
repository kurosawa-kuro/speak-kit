"use client"

import { useCallback, useEffect, useRef } from "react"
import { useRpc } from "./use-rpc"

/**
 * 採点待ち（verdict が pending）の回答を、同じ送信内容で 2 秒ごとに問い合わせる。
 * サーバーは同じ attempt_id の再送を「採点が済んだか」の問い合わせとして扱う。
 */
export function useGradePoller(onGraded) {
  const poll = useRpc("skill_trainer_submit_attempt_v2")
  const pending = useRef(new Map())
  const busy = useRef(false)
  const handler = useRef(onGraded)
  handler.current = onGraded

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = pending.current.entries().next().value
      if (!next || busy.current) return
      const [attemptId, payload] = next
      busy.current = true
      poll.trigger(payload).then((value) => {
        if (!value || value.attemptId !== attemptId || value.verdict === "pending") return
        pending.current.delete(attemptId)
        handler.current(value)
      }).finally(() => {
        busy.current = false
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [poll.trigger])

  const watch = useCallback((attemptId, payload) => pending.current.set(attemptId, payload), [])
  const forget = useCallback((attemptId) => pending.current.delete(attemptId), [])
  return { watch, forget }
}
