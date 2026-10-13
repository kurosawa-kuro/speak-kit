"use client"

import { useState } from "react"
import { SCREENS } from "./ui/labels"
import { Today } from "./screens/today"
import { Practice } from "./screens/practice/screen"
import { Talk } from "./screens/talk"
import { Records } from "./screens/records"

export function Shell() {
  const [screen, setScreen] = useState("today")
  const [practiceTarget, setPracticeTarget] = useState(null)
  function openPractice(target) {
    setPracticeTarget(target || { tab: "drill" })
    setScreen("practice")
  }
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-900">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="flex h-11 items-center rounded-md border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300">☰ アプリ一覧</span>
          <h1 className="text-lg font-bold">英会話学習</h1>
          <nav className="ml-auto flex gap-1 rounded-full border border-neutral-800 bg-neutral-950 p-1">
            {SCREENS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={screen === item.id ? "page" : undefined}
                onClick={() => setScreen(item.id)}
                className={`h-8 rounded-full px-4 text-sm font-semibold ${screen === item.id ? "bg-neutral-800 text-neutral-100" : "text-neutral-400"}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {screen === "today" ? <Today onPractice={openPractice} onTalk={() => setScreen("talk")} /> : null}
        {screen === "practice" ? <Practice target={practiceTarget} /> : null}
        {screen === "talk" ? <Talk /> : null}
        {screen === "records" ? <Records /> : null}
      </main>
    </div>
  )
}
