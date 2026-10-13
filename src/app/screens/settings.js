"use client"

import { useEffect, useState } from "react"
import { aiReasonLabel } from "../ui/labels"

const AI_FEATURES = ["文字回答の AI 採点", "会話相手の返答", "言えなかった表現の候補の抽出", "混同ペアの違いの下書き"]

async function request(method, body) {
  const response = await fetch("/api/settings", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  })
  return response.json()
}

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-1 border-t border-neutral-800 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-neutral-400">{label}</p>
      <div className="text-sm text-neutral-100">{children}</div>
    </div>
  )
}

export function Settings() {
  const [view, setView] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    request("GET")
      .then((body) => (body.ok ? setView(body.data) : setError("設定を読み込めませんでした。")))
      .catch(() => setError("設定を読み込めませんでした。"))
  }, [])

  async function toggleAi() {
    if (!view || saving) return
    setSaving(true)
    setError("")
    try {
      const body = await request("POST", { ai_enabled: !view.settings.aiEnabled })
      if (body.ok) setView(body.data)
      else setError("保存できませんでした。")
    } catch {
      setError("保存できませんでした。")
    } finally {
      setSaving(false)
    }
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
            disabled={saving}
            className={`h-9 rounded-full px-4 font-semibold transition-colors disabled:opacity-60 ${
              settings.aiEnabled ? "bg-emerald-700 text-white" : "bg-neutral-700 text-neutral-200"
            }`}
          >
            {settings.aiEnabled ? "オン" : "オフ"}
          </button>
        </Row>
        <Row label="API キー">{ai.keyConfigured ? "設定済み" : "未設定"}</Row>
        <Row label="いまの状態">{ai.aiEnabled ? "AI を使っています" : aiReasonLabel(ai.reason)}</Row>
        {settings.aiEnabled && !ai.keyConfigured && (
          <p className="pb-3 text-sm text-amber-200">オンにしても、API キーが設定されるまで AI は使えません。キーはサーバーの環境変数 ANTHROPIC_API_KEY に置きます。</p>
        )}
        {!ai.aiEnabled && (
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
        <Row label="ログイン">{startup.login === "disabled" ? "無効（一人で使用）" : "有効"}</Row>
        <Row label="保存先">
          {startup.database.kind === "local" ? `ローカル DB（${startup.database.name}）` : startup.database.name}
        </Row>
      </section>

      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  )
}
