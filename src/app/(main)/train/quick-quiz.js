"use client"

import { useEffect, useRef, useState } from "react"
import { BoundaryPair, ErrorCard, LoadingCard } from "../../_components/ui"
import { useRpc } from "../../_hooks/use-rpc"
import { QUIZ_FILTERS, quizTypeLabel } from "../../_lib/labels"
import { uuid } from "../../_lib/uuid"

function optionTone(option, selectedId, result) {
  if (result) {
    if (option.id === result.correctOptionId) return "border-emerald-400 bg-emerald-500/15 text-emerald-100"
    if (option.id === selectedId) return "border-amber-400 bg-amber-500/10 text-amber-100"
    return "border-neutral-800 bg-neutral-950 text-neutral-500"
  }
  return option.id === selectedId ? "border-emerald-400 bg-neutral-800" : "border-neutral-700 bg-neutral-950 hover:border-neutral-500"
}

function QuizResult({ result, onNext }) {
  const success = result.outcome === "success"
  return (
    <div className={`rounded-xl border bg-neutral-900 px-4 py-4 ${success ? "border-emerald-500/30" : "border-amber-500/40"}`}>
      <p className={`text-sm font-bold ${success ? "text-emerald-300" : "text-amber-200"}`}>{success ? "正解 ✓" : "不正解"}</p>
      <div className="mt-3 flex flex-col gap-3 text-sm">
        <div>
          <p className="text-xs font-semibold text-emerald-400">正解</p>
          <p className="mt-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-base font-semibold text-emerald-100">{result.correctText}</p>
        </div>
        {result.confusedLabel && <p className="text-amber-200">{result.confusedLabel} と {result.correctLabel} を取り違えています。</p>}
        <BoundaryPair pair={result.difference} withAxis />
        {result.skill && (
          <div>
            <p className="text-xs font-semibold text-neutral-500">この表現</p>
            <p className="mt-1 text-emerald-100">{result.skill.form}　{result.skill.meaning}</p>
          </div>
        )}
        {result.itemStable && success && <p className="text-neutral-300">この問題は、間を空けて2回正解したので、もう出しません。</p>}
        {result.promotion && <p className="font-semibold text-emerald-200">{result.promotion.label} は選べるようになりました。</p>}
      </div>
      <button type="button" onClick={onNext} className="mt-4 flex h-12 w-full items-center justify-center rounded-md bg-emerald-500 font-bold text-neutral-950">
        {result.promotion ? "次は自分で言ってみよう（Enter）" : "次へ（Enter）"}
      </button>
    </div>
  )
}

export function QuickQuiz({ onSpeak }) {
  const next = useRpc("skill_trainer_quiz_next_v1")
  const answer = useRpc("skill_trainer_submit_attempt_v2")
  const [filter, setFilter] = useState("")
  const [item, setItem] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [result, setResult] = useState(null)
  const [counts, setCounts] = useState(null)
  const [emptyMessage, setEmptyMessage] = useState("")
  const shownAt = useRef(Date.now())

  const loadNext = (nextFilter = filter) => {
    setResult(null)
    setSelectedId(null)
    answer.reset()
    next.trigger(nextFilter ? { quiz_type: nextFilter } : {}).then((value) => {
      if (!value) return
      setItem(value.item ?? null)
      setEmptyMessage(value.message ?? "")
      setCounts({ stable: value.stableCount, total: value.itemCount })
      shownAt.current = Date.now()
    })
  }

  useEffect(() => {
    loadNext()
  }, [])

  const changeFilter = (value) => {
    if (value === filter) return
    setFilter(value)
    setItem(null)
    loadNext(value)
  }

  const choose = (option) => {
    if (!item || result || answer.loading) return
    setSelectedId(option.id)
    answer.trigger({
      response_mode: "choice",
      submission_id: uuid(),
      item_key: item.itemKey,
      option_set_version: item.optionSetVersion,
      selected_option_id: option.id,
      option_order: item.options.map((entry) => entry.id),
      latency_ms: Math.max(0, Date.now() - shownAt.current),
    }).then((value) => {
      if (!value) setSelectedId(null)
      else setResult(value)
    })
  }

  const proceed = () => {
    if (result?.promotion) onSpeak(result.promotion)
    else loadNext()
  }

  useEffect(() => {
    const onKey = (event) => {
      const target = event.target
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return
      if (!result && item && /^[1-4]$/.test(event.key)) {
        const option = item.options[Number(event.key) - 1]
        if (option) {
          event.preventDefault()
          choose(option)
        }
      } else if (result && event.key === "Enter") {
        event.preventDefault()
        proceed()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {QUIZ_FILTERS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => changeFilter(entry.value)}
            className={`h-9 rounded-md border px-3 text-xs font-semibold ${
              filter === entry.value ? "border-emerald-400 bg-emerald-500/15 text-emerald-200" : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-emerald-400">{item ? quizTypeLabel(item.quizType) : ""}</span>
        {counts && <span className="text-neutral-500">安定 {counts.stable} / {counts.total} 問</span>}
      </div>

      {next.loading && !item && <LoadingCard>問題を準備中...</LoadingCard>}

      {(next.error !== null || answer.error !== null) && (
        <ErrorCard message={answer.error ?? next.error} fallback="クイズを読み込めませんでした。もう一度お試しください。" onRetry={() => loadNext()} />
      )}

      {!next.loading && !item && emptyMessage !== "" && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-10 text-center text-sm text-emerald-100">{emptyMessage}</div>
      )}

      {item && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <p className="text-xl font-bold leading-relaxed lg:text-2xl">{item.prompt}</p>
          <ol className="mt-5 flex flex-col gap-2">
            {item.options.map((option, index) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => choose(option)}
                  disabled={result !== null || answer.loading}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-base leading-snug transition-colors lg:text-lg ${optionTone(option, selectedId, result)}`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-sm font-bold text-neutral-300">{index + 1}</span>
                  <span>{option.text}</span>
                </button>
              </li>
            ))}
          </ol>
          {!result && <p className="mt-3 text-xs text-neutral-500">数字キー 1〜4 でも選べます。</p>}
        </div>
      )}

      {result && <QuizResult result={result} onNext={proceed} />}
    </section>
  )
}
