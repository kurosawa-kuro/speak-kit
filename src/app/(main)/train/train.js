"use client"

import Link from "next/link"
import { useState } from "react"
import { Practice } from "./practice"
import { QuickQuiz } from "./quick-quiz"

const SURFACES = [
  ["quiz", "クイッククイズ"],
  ["practice", "実践練習"],
]

/** 練習。?plan=today なら今日の計画、ほかは自由練習（クイッククイズと実践練習）。 */
export function Train({ planMode, openPractice, skillKey }) {
  const [surface, setSurface] = useState(openPractice ? "practice" : "quiz")
  const [start, setStart] = useState({ skillKey, run: 0 })
  const [practiceOpened, setPracticeOpened] = useState(planMode || openPractice)

  const showPractice = (nextSkillKey = null) => {
    if (nextSkillKey !== null) setStart((current) => ({ skillKey: nextSkillKey, run: current.run + 1 }))
    setSurface("practice")
    setPracticeOpened(true)
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <Link href="/today" className="flex items-center gap-2 text-sm text-neutral-400">← 戻る</Link>
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{planMode ? "今日の練習" : "自由練習"}</span>
      </div>

      {!planMode && (
        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="練習の種類">
          {SURFACES.map(([value, label]) => (
            <button
              type="button"
              role="tab"
              key={value}
              aria-selected={surface === value}
              onClick={() => (value === "quiz" ? setSurface("quiz") : showPractice())}
              className={`h-12 rounded-lg border text-sm font-bold transition-colors ${
                surface === value
                  ? "border-emerald-400 bg-emerald-500 text-neutral-950"
                  : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {!planMode && surface === "quiz" && (
        <QuickQuiz onSpeak={(promotion) => showPractice(promotion.kind === "skill" ? promotion.skillKey : "")} />
      )}

      {practiceOpened && (
        <div className={planMode || surface === "practice" ? "flex flex-col gap-4" : "hidden"}>
          <Practice key={start.run} planMode={planMode} skillKey={start.skillKey || null} />
        </div>
      )}
    </>
  )
}
