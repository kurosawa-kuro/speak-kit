"use client"

import { useMemo, useState } from "react"
import { NavContext, parseLocation } from "./ui/nav"
import { Today } from "./screens/today"
import { Train } from "./screens/train"
import { Talk } from "./screens/talk"
import { Records } from "./screens/records"

const TABS = [
  { label: "今日", to: "/today" },
  { label: "練習", to: "/train" },
  { label: "会話", to: "/talk" },
  { label: "記録", to: "/progress" },
]

function isActiveTab(pathname, to) {
  if (to === "/today") return pathname === "/" || pathname === "/today"
  if (to === "/talk") return pathname.startsWith("/talk")
  if (to === "/progress") return pathname.startsWith("/progress")
  return pathname.startsWith("/train")
}

export function Shell() {
  const [location, setLocation] = useState({ pathname: "/", search: "", key: 0 })
  const nav = useMemo(() => ({
    pathname: location.pathname,
    searchParams: new URLSearchParams(location.search),
    navigate: (to) => setLocation((current) => ({ ...parseLocation(to), key: current.key + 1 })),
  }), [location])
  const { pathname } = location
  return (
    <NavContext.Provider value={nav}>
      <div className="min-h-screen bg-neutral-950 text-neutral-100">
        <header className="border-b border-neutral-800 bg-neutral-900">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3 sm:px-6 lg:max-w-6xl lg:flex-row lg:items-center lg:px-8">
            <div className="flex items-center gap-3">
              <span className="flex h-11 shrink-0 items-center gap-1 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300">
                <span className="sm:hidden">☰</span>
                <span className="hidden sm:inline">☰ アプリ一覧</span>
              </span>
              <h1 className="whitespace-nowrap text-lg font-bold text-neutral-100">英会話学習</h1>
            </div>
            <nav className="grid grid-cols-4 gap-1 rounded-full border border-neutral-800 bg-neutral-950 p-1 lg:ml-auto lg:flex" aria-label="ページタブ">
              {TABS.map((tab) => {
                const active = isActiveTab(pathname, tab.to)
                return (
                  <button
                    key={tab.to}
                    type="button"
                    onClick={() => nav.navigate(tab.to)}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-10 min-w-0 items-center justify-center rounded-full px-2 text-sm font-semibold transition-colors lg:h-8 lg:px-4 ${
                      active ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-200 active:bg-neutral-800/60"
                    }`}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </nav>
          </div>
        </header>
        <main key={location.key} className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6 lg:max-w-6xl lg:px-8">
          {pathname === "/" || pathname === "/today" ? <Today /> : null}
          {pathname === "/train" ? <Train /> : null}
          {pathname === "/talk" ? <Talk /> : null}
          {pathname === "/progress" ? <Records /> : null}
        </main>
      </div>
    </NavContext.Provider>
  )
}
