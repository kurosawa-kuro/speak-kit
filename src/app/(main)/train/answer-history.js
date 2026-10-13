"use client"

import { BoundaryPair } from "../../_components/ui"
import { verdictLabel } from "../../_lib/labels"

const TONE = {
  pending: ["border-neutral-800", "text-neutral-300"],
  success: ["border-emerald-500/30", "text-emerald-300"],
}
const OTHER = ["border-amber-500/40", "text-amber-200"]

function Field({ label, children, accent = false }) {
  return (
    <div>
      <p className={`text-xs font-semibold ${accent ? "text-emerald-400" : "text-neutral-500"}`}>{label}</p>
      {children}
    </div>
  )
}

/** これまでの回答（新しい順に 3 件）。見出しと再判定のボタンは、サーバーの verdict と canRegrade で決める。 */
export function AnswerHistory({ notices, onRegrade, regrading }) {
  if (notices.length === 0) return null
  return (
    <section className="flex flex-col gap-3" aria-label="これまでの回答">
      <h2 className="text-xs font-semibold text-neutral-500">これまでの回答</h2>
      {notices.map((notice) => {
        const [border, text] = TONE[notice.verdict] ?? OTHER
        return (
          <article key={notice.id} className={`rounded-xl border bg-neutral-900 px-4 py-4 ${border}`}>
            <p className={`text-sm font-bold ${text}`}>{verdictLabel(notice.verdict)}</p>
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <Field label="質問"><p className="mt-1 font-semibold leading-relaxed">{notice.question}</p></Field>
              <Field label="あなたの回答"><p className="mt-1 rounded-md bg-neutral-950 px-3 py-2 leading-relaxed">{notice.answer}</p></Field>
              <Field label="正解" accent>
                <p className="mt-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-base font-semibold leading-relaxed text-emerald-100">{notice.expected}</p>
              </Field>
              <Field label="解説"><p className="mt-1 leading-relaxed text-neutral-300">{notice.detail}</p></Field>
              {notice.difference && (
                <Field label="違い"><BoundaryPair pair={notice.difference} className="mt-1 text-emerald-100" /></Field>
              )}
            </div>
            {notice.canRegrade && (
              <button type="button" onClick={() => onRegrade(notice.id)} disabled={regrading} className="mt-3 h-10 w-full rounded-md bg-amber-400 text-sm font-bold text-neutral-950">
                再判定する
              </button>
            )}
          </article>
        )
      })}
    </section>
  )
}
