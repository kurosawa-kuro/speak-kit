"use client"

import { useCallback, useRef, useState } from "react"
import { aiReasonLabel } from "../_lib/labels"
import { post } from "../_lib/rpc"

/**
 * RPC を 1 つ呼ぶフック。trigger は成功なら data、失敗なら null を返す。
 * error は画面に出す文字列（無ければ null）。clearError で消せる。
 */
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
  const clearError = useCallback(() => setState((current) => ({ ...current, error: null })), [])
  return { ...state, trigger, reset, clearError }
}
