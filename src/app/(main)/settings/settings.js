"use client"

import { useEffect } from "react"
import { useRpc } from "../../_hooks/use-rpc"
import { usd } from "../../_lib/format"
import { aiReasonLabel } from "../../_lib/labels"

const AI_FEATURES = ["文字回答の AI 採点", "会話相手の返答", "言えなかった表現の候補の抽出", "混同ペアの違いの下書き"]

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-1 border-t border-neutral-800 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-neutral-400">{label}</p>
      <div className="text-sm text-neutral-100">{children}</div>
    </div>
  )
}

export function Settings() {
  const load = useRpc("skill_trainer_get_settings_v1")
  const save = useRpc("skill_trainer_save_settings_v1")

  useEffect(() => {
    load.trigger({})
  }, [])

  const view = save.data ?? load.data
  const error = load.error !== null ? "設定を読み込めませんでした。" : save.error !== null ? "保存できませんでした。" : ""

  const toggleAi = () => {
    if (!view || save.loading) return
    save.trigger({ ai_enabled: !view.settings.aiEnabled })
  }

  if (!view) {
    return <p className="text-sm text-neutral-400">{error || "読み込み中…"}</p>
  }

  const { settings, ai, startup } = view
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">設定</h2>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2">
        <h3 className="pt-2 text-sm font-semibold text-neutral-200">AI</h3>
        <Row label="AI を使う">
          <button
            type="button"
            role="switch"
            aria-checked={settings.aiEnabled}
            onClick={toggleAi}
            disabled={save.loading}
            className={`h-9 rounded-full px-4 font-semibold transition-colors disabled:opacity-60 ${
              settings.aiEnabled ? "bg-emerald-700 text-white" : "bg-neutral-700 text-neutral-200"
            }`}
          >
            {settings.aiEnabled ? "オン" : "オフ"}
          </button>
        </Row>
        <Row label="API キー">{ai.keyConfigured ? "設定済み" : "未設定"}</Row>
        <Row label="いまの状態">{ai.aiAvailable ? "AI を使っています" : aiReasonLabel(ai.aiReason)}</Row>
        <Row label="今日の利用額">{usd(ai.usage.dayUsd)} / {usd(ai.usage.dailyLimitUsd)}</Row>
        <Row label="今月の利用額">{usd(ai.usage.monthUsd)} / {usd(ai.usage.monthlyLimitUsd)}</Row>
        {settings.aiEnabled && !ai.keyConfigured && (
          <p className="pb-3 text-sm text-amber-200">オンにしても、API キーが設定されるまで AI は使えません。キーはサーバーの環境変数 ANTHROPIC_API_KEY に置きます。</p>
        )}
        {!ai.aiAvailable && (
          <div className="pb-3 text-sm text-neutral-300">
            <p>AI を使わない間は、次が使えません。練習・クイズ・記録はそのまま使えます。</p>
            <ul className="mt-1 list-disc pl-5 text-neutral-400">
              {AI_FEATURES.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2">
        <h3 className="pt-2 text-sm font-semibold text-neutral-200">起動時の設定（ここでは変えられません）</h3>
        <Row label="ログイン">{startup.login === "password" ? "合言葉（一人で使用）" : "無効（一人で使用）"}</Row>
        <Row label="保存先">
          {startup.database.kind === "local" ? `ローカル DB（${startup.database.name}）` : startup.database.name}
        </Row>
        <Row label="AI のモデル">{startup.ai.model}</Row>
        <Row label="AI の利用上限">1 日 {usd(startup.ai.dailyLimitUsd)}・1 か月 {usd(startup.ai.monthlyLimitUsd)}</Row>
      </section>

      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  )
}
