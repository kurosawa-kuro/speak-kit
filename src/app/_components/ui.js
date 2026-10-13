"use client"

import { aiReasonLabel, axisLabel, uiErrorMessage } from "../_lib/labels"

export function Spinner({ size = "h-5 w-5" }) {
  return <span className={`${size} animate-spin rounded-full border-2 border-current border-t-transparent`} />
}

export function LoadingCard({ children }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-6 py-16 text-neutral-300">
      <Spinner />
      <span>{children}</span>
    </div>
  )
}

/** エラーと「再試行」。message はサーバーの文言（日本語でなければ fallback を出す）。 */
export function ErrorCard({ message, fallback, onRetry, retryLabel = "↻ 再試行" }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
      <div className="flex gap-3 text-sm text-amber-200">
        <span>⚠</span>
        <p>{uiErrorMessage(message, fallback)}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-neutral-800 text-sm font-semibold">
          {retryLabel}
        </button>
      )}
    </div>
  )
}

export function Metric({ label, value, large = false }) {
  return (
    <div className="rounded-md bg-neutral-800 px-2.5 py-2">
      <p className="text-[10px] text-neutral-500">{label}</p>
      <p className={`mt-0.5 font-semibold text-neutral-100 ${large ? "text-lg" : "text-sm"}`}>{value}</p>
    </div>
  )
}

export function AiUnavailableBanner({ reason, children }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3">
      <span className="text-amber-400">⚠</span>
      <p className="text-sm text-amber-200">
        {aiReasonLabel(reason)}
        {children}
      </p>
    </div>
  )
}

/** 混同ペアの二つの違い（ラベル・短い説明・手がかり）。 */
export function BoundaryPair({ pair, withAxis = false, className = "text-emerald-100" }) {
  if (!pair?.labelA) return null
  return (
    <div className={className}>
      {withAxis && <p className="text-xs font-semibold text-neutral-500">違い（{axisLabel(pair.confusionType)}）</p>}
      <p className={withAxis ? "mt-1" : undefined}>{pair.labelA}　{pair.keyA}　{pair.directionA}</p>
      <p>{pair.labelB}　{pair.keyB}　{pair.directionB}</p>
    </div>
  )
}

export function SectionTitle({ children }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{children}</p>
}
