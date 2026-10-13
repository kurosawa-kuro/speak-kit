"use client"

import { useEffect, useState } from "react"
import { post } from "../../ui/rpc"
import { QUIZ_FILTERS } from "../../ui/labels"

export function Quiz({ onSpeak }) {
  const [filter, setFilter] = useState("")
  const [item, setItem] = useState(null)
  const [counts, setCounts] = useState({ stable: 0, total: 0 })
  const [picked, setPicked] = useState(null)
  const [result, setResult] = useState(null)
  const [shownAt, setShownAt] = useState(0)
  const [empty, setEmpty] = useState("")
  const [formReady, setFormReady] = useState(false)

  async function load(nextFilter = filter) {
    setPicked(null)
    setResult(null)
    const quiz = await post("skill_trainer_quiz_next_v1", nextFilter ? { quiz_type: nextFilter } : {})
    setItem(quiz.data?.item || null)
    setEmpty(quiz.data?.item ? "" : quiz.data?.message || "いま出せる問題はありません。")
    setCounts({ stable: quiz.data?.stableCount || 0, total: quiz.data?.itemCount || 0 })
    setFormReady(quiz.data?.formReady === true)
    setShownAt(Date.now())
  }

  useEffect(() => { load("") }, [])

  async function choose(optionId) {
    if (!item || result) return
    setPicked(optionId)
    const submitted = await post("skill_trainer_submit_attempt_v2", {
      response_mode: "choice",
      submission_id: crypto.randomUUID(),
      item_key: item.itemKey,
      option_set_version: item.optionSetVersion,
      selected_option_id: optionId,
      option_order: item.options.map((option) => option.id),
      latency_ms: Math.max(0, Date.now() - shownAt),
    })
    if (submitted.ok) setResult(submitted.data)
  }

  useEffect(() => {
    function onKey(event) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (result && event.key === "Enter") load(filter)
      const index = Number(event.key) - 1
      if (!result && item && index >= 0 && index < item.options.length) choose(item.options[index].id)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const filterLabel = QUIZ_FILTERS.find((entry) => entry.id === filter)?.label
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {QUIZ_FILTERS.filter((entry) => !entry.gated || formReady).map((entry) => (
            <button key={entry.label} type="button" onClick={() => { setFilter(entry.id); load(entry.id) }} className={`rounded-md px-3 py-1 text-sm ${filter === entry.id ? "bg-emerald-500 font-bold text-neutral-950" : "bg-neutral-800 text-neutral-300"}`}>{entry.label}</button>
          ))}
        </div>
        <span className="text-sm text-emerald-400">安定 {counts.stable}/{counts.total}問</span>
      </div>
      <p className="mt-3 text-xs text-emerald-400">{filterLabel}</p>
      <article className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="text-2xl font-bold">{item?.prompt || empty || "問題を読んでいます。"}</h2>
        <div className="mt-4 flex flex-col gap-2">
          {item?.options?.map((option, index) => {
            const correct = result && option.text === result.correctText
            const wrong = result && option.id === picked && result.outcome === "failure"
            return (
              <button key={option.id} type="button" onClick={() => choose(option.id)} className={`flex items-center rounded-lg border bg-neutral-950 px-4 py-3 text-left ${correct ? "border-emerald-500" : wrong ? "border-red-500" : "border-neutral-800"}`}>
                <span className="mr-3 grid h-6 w-6 place-items-center rounded bg-neutral-800 text-xs">{index + 1}</span>
                {option.text}
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          {result?.promotion
            ? `${result.promotion.label} は選べるようになりました。`
            : result
              ? (result.outcome === "success" ? "正解です。Enterで次へ進みます。" : `違います。正解は ${result.correctText}`)
              : "数字キー1〜4でも選べます。"}
        </p>
        {result?.promotion ? (
          <button type="button" onClick={() => onSpeak?.(result.promotion)} className="mt-3 h-11 w-full rounded-md bg-emerald-500 font-bold text-neutral-950">次は自分で言ってみよう</button>
        ) : null}
      </article>
    </>
  )
}
