"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const TABS = [
  { label: "今日", href: "/today" },
  { label: "練習", href: "/train" },
  { label: "会話", href: "/talk" },
  { label: "記録", href: "/records" },
  { label: "設定", href: "/settings" },
]

export function Tabs() {
  const pathname = usePathname()
  return (
    <nav className="grid grid-cols-5 gap-1 rounded-full border border-neutral-800 bg-neutral-950 p-1 lg:ml-auto lg:flex" aria-label="ページタブ">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-10 min-w-0 items-center justify-center rounded-full px-2 text-sm font-semibold transition-colors lg:h-8 lg:px-4 ${
              active ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-200 active:bg-neutral-800/60"
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
