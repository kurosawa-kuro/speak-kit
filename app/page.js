"use client"

import { useState } from "react"

const NAMES = [
  "skill_trainer_get_today_plan_v2",
  "skill_trainer_quiz_next_v1",
  "skill_trainer_submit_attempt_v2",
  "skill_trainer_get_progress_v2",
]

async function post(name, body) {
  const response = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return response.json()
}

export default function Page() {
  const [log, setLog] = useState("まだ実行していません。")
  const [item, setItem] = useState(null)

  async function run() {
    const lines = []
    const plan = await post(NAMES[0], {})
    lines.push(`today ${plan.ok} ${plan.code} items=${plan.data?.plan?.length ?? 0}`)
    const quiz = await post(NAMES[1], {})
    lines.push(`quiz ${quiz.ok} ${quiz.code} item=${quiz.data?.item?.itemKey ?? "none"}`)
    const current = quiz.data?.item
    setItem(current)
    if (current) {
      const correct = current.options?.[0]
      const submitted = await post(NAMES[2], {
        response_mode: "choice",
        submission_id: crypto.randomUUID(),
        item_key: current.itemKey,
        option_set_version: current.optionSetVersion,
        selected_option_id: correct?.id,
        option_order: current.options.map((option) => option.id),
        latency_ms: 10,
      })
      lines.push(`choice ${submitted.ok} ${submitted.code} outcome=${submitted.data?.outcome}`)
    }
    const progress = await post(NAMES[3], {})
    lines.push(`progress ${progress.ok} ${progress.code} skills=${progress.data?.skills?.length ?? 0}`)
    setLog(lines.join("\n"))
  }

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>speak-kit</h1>
      <p>選択式の練習です。音声入力はありません。学習者は1人です。</p>
      <button type="button" onClick={run}>今日の分を進める</button>
      <pre>{log}</pre>
      {item ? <p>いまの問題: {item.prompt}</p> : null}
    </main>
  )
}
