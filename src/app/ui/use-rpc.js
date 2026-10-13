"use client"

import { useCallback, useRef, useState } from "react"
import { aiReasonLabel } from "./labels"
import { post } from "./rpc"

export function useRpc(name) {
  const [state, setState] = useState({ data: null, loading: false, error: null })
  const latest = useRef(0)
  const trigger = useCallback(async (body) => {
    const call = ++latest.current
    setState((current) => ({ ...current, loading: true, error: null }))
    let result
    try {
      result = await post(name, body)
    } catch {
      result = { ok: false, error: { message: "" } }
    }
    if (call !== latest.current) return result.ok ? result.data : null
    if (result.ok) {
      setState({ data: result.data, loading: false, error: null })
      return result.data
    }
    const error = result.code === "ai_unavailable"
      ? aiReasonLabel(result.data?.aiReason)
      : result.error?.message || result.code || ""
    setState((current) => ({ ...current, loading: false, error }))
    return null
  }, [name])
  const reset = useCallback(() => {
    latest.current += 1
    setState({ data: null, loading: false, error: null })
  }, [])
  return { ...state, trigger, reset }
}
