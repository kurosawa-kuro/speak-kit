"use client"

import { useState } from "react"
import { Drill } from "./drill"
import { Quiz } from "./quiz"

export function Practice({ target }) {
  const [tab, setTab] = useState(target?.tab || "quiz")
  const [drillTarget, setDrillTarget] = useState(target || null)
  return (
    <section>
      <div className="mb-3 flex items-center justify-between text-sm text-neutral-400">
        <span>← 戻る</span>
        <span>自由練習</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setTab("quiz")} className={`h-12 rounded-xl font-bold ${tab === "quiz" ? "bg-emerald-500 text-neutral-950" : "bg-neutral-800 text-neutral-300"}`}>クイッククイズ</button>
        <button type="button" onClick={() => setTab("drill")} className={`h-12 rounded-xl font-bold ${tab === "drill" ? "bg-emerald-500 text-neutral-950" : "bg-neutral-800 text-neutral-300"}`}>実践練習</button>
      </div>
      <div className="mt-4">
        {tab === "quiz" ? (
          <Quiz onSpeak={(promotion) => {
            setDrillTarget({ tab: "drill", skillKey: promotion.skillKey, mode: "controlled_recall", label: promotion.label })
            setTab("drill")
          }} />
        ) : (
          <Drill target={drillTarget} />
        )}
      </div>
    </section>
  )
}
