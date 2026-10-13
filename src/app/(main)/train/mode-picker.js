"use client"

import { PRACTICE_MODES } from "../../_lib/labels"

export function ModePicker({ mode, onPick }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold text-neutral-500">練習方法を選ぶ</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {PRACTICE_MODES.map((item) => (
          <button
            type="button"
            key={item.value}
            onClick={() => onPick(item.value)}
            aria-pressed={mode === item.value}
            className={`min-h-12 rounded-lg border px-3 py-2 text-center text-sm font-semibold leading-snug transition-colors ${
              mode === item.value
                ? "border-emerald-400 bg-emerald-500 text-neutral-950"
                : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
