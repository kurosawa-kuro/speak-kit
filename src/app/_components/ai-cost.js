"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect } from "react"
import { useRpc } from "../_hooks/use-rpc"
import { yen } from "../_lib/format"

const REFRESH_MS = 30_000

/** ヘッダーに出す、今日の AI の利用額（円の目安）。画面を移るたびと 30 秒ごとに読み直す。 */
export function AiCost() {
  const pathname = usePathname()
  const { data, trigger } = useRpc("skill_trainer_get_settings_v1")
  useEffect(() => {
    trigger({})
    const timer = setInterval(() => trigger({}), REFRESH_MS)
    return () => clearInterval(timer)
  }, [pathname, trigger])
  const usage = data?.ai?.usage
  if (!usage) return null
  return (
    <Link
      href="/settings"
      title={`今日 ${yen(usage.dayUsd, usage.usdJpy)} / 上限 ${yen(usage.dailyLimitUsd, usage.usdJpy)}（1 ドル = ${usage.usdJpy} 円で計算）`}
      className="flex h-9 shrink-0 items-center rounded-md border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300 hover:text-neutral-100"
    >
      今日の AI {yen(usage.dayUsd, usage.usdJpy)}
    </Link>
  )
}
