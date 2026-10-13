"use client"

import { BoundaryPair, Spinner } from "../../_components/ui"
import { capabilityLabel, purposeLabel, reasonLabel } from "../../_lib/labels"

/** 出題と回答欄。混同の確認問題のときは、二つの違いも出す。 */
export function ExerciseCard({ capability, planItem, skillLabel, boundary, prompt, answer, onAnswer, onSubmit, busy, submitting }) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-emerald-400">{capabilityLabel(capability)}</span>
        {planItem && <span className="rounded-full bg-neutral-800 px-2.5 py-1">{purposeLabel(planItem.purpose)} · {reasonLabel(planItem.reasonCode)}</span>}
      </div>
      <p className="mt-4 text-xs text-neutral-500">{skillLabel}</p>
      {boundary && <BoundaryPair pair={boundary} className="mt-3 text-sm text-emerald-100" />}
      <p className="mt-2 text-xl font-bold leading-relaxed lg:text-2xl">{prompt}</p>
      <textarea
        value={answer}
        onChange={(event) => onAnswer(event.target.value)}
        placeholder="回答を入力"
        className="mt-5 min-h-32 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-4 text-base outline-none focus:border-emerald-500 lg:min-h-48 lg:text-lg"
      />
      <button type="button" onClick={onSubmit} disabled={busy || answer.trim() === ""} className="mt-4 flex h-12 w-full items-center justify-center rounded-md bg-emerald-500 font-bold text-neutral-950 disabled:bg-neutral-800 disabled:text-neutral-500">
        {submitting ? <Spinner /> : "回答する"}
      </button>
    </section>
  )
}
