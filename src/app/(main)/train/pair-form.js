"use client"

import { useState } from "react"
import { Spinner } from "../../_components/ui"
import { useRpc } from "../../_hooks/use-rpc"
import { isImeEnter } from "../../_lib/keys"
import { uiErrorMessage } from "../../_lib/labels"

const INPUT = "h-11 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm outline-none focus:border-emerald-500"

/** 混ざる二つを登録する。登録できたら、最初の確認問題を onProbe に渡す。 */
export function PairForm({ onProbe }) {
  const registerPair = useRpc("skill_trainer_register_confusion_pair_v2")
  const [first, setFirst] = useState("")
  const [second, setSecond] = useState("")
  const blank = first.trim() === "" || second.trim() === ""
  const keepIme = (event) => {
    if (isImeEnter(event)) event.preventDefault()
  }

  return (
    <form
      className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (blank) return
        registerPair.trigger({ label_a: first.trim(), label_b: second.trim() }).then((value) => {
          if (!value) return
          onProbe(value.probe)
          setFirst("")
          setSecond("")
        })
      }}
    >
      <p className="text-xs font-semibold text-neutral-500">この二つが混ざる</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input value={first} onChange={(event) => setFirst(event.target.value)} onKeyDown={keepIme} placeholder="一つ目" className={INPUT} />
        <input value={second} onChange={(event) => setSecond(event.target.value)} onKeyDown={keepIme} placeholder="二つ目" className={INPUT} />
      </div>
      <button type="submit" disabled={registerPair.loading || blank} className="mt-3 flex h-11 w-full items-center justify-center rounded-md bg-neutral-800 text-sm font-semibold disabled:text-neutral-500">
        {registerPair.loading ? <Spinner size="h-4 w-4" /> : "違いを作って確認する"}
      </button>
      {registerPair.error !== null && (
        <p className="mt-2 text-sm text-amber-300">{uiErrorMessage(registerPair.error, "違いを作れませんでした。もう一度お試しください。")}</p>
      )}
    </form>
  )
}
