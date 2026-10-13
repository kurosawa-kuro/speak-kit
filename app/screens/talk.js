"use client"

import { useState } from "react"
import { post } from "../ui/rpc"
import { SCENARIOS } from "../ui/labels"

export function Talk() {
  const [scenario, setScenario] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [history, setHistory] = useState([])
  const [draft, setDraft] = useState("")
  const [notice, setNotice] = useState("")
  const [summary, setSummary] = useState(null)

  async function start(next) {
    setScenario(next)
    setSummary(null)
    setNotice("")
    const result = await post("skill_trainer_start_talk_session_v2", {
      scenario: next,
      session_id: crypto.randomUUID(),
    })
    if (!result.ok) {
      setNotice(result.error?.message || "会話を始められませんでした。")
      return
    }
    setSessionId(result.data.conversationSessionId)
    setHistory([{ role: "partner", content: result.data.assistantMessage }])
  }

  async function send(event) {
    event.preventDefault()
    const result = await post("skill_trainer_send_talk_message_v2", {
      conversation_session_id: sessionId,
      turn_id: crypto.randomUUID(),
      message: draft,
    })
    if (!result.ok) {
      setNotice(result.error?.message || "会話を続けられませんでした。")
      return
    }
    setHistory([...history, { role: "learner", content: draft }, { role: "partner", content: result.data.assistantMessage }])
    setDraft("")
  }

  async function review(candidate, decision) {
    const result = await post("skill_trainer_review_candidate_v2", {
      candidate_id: String(candidate.candidateId),
      decision,
      reviewed_by: "owner",
      stable_key: `FREEZE_${candidate.candidateId}`,
      canonical_form: candidate.pattern,
      exercise_prompt: candidate.meaning || "この表現を英語で言う",
      expected_reference: candidate.pattern,
      category: "OUTPUT",
    })
    setNotice(result.ok ? (decision === "approved" ? "承認して練習項目にしました。" : "却下しました。") : result.error?.message)
    if (result.ok) {
      setSummary({
        ...summary,
        candidates: summary.candidates.filter((item) => item.candidateId !== candidate.candidateId),
      })
    }
  }

  async function finish() {
    const result = await post("skill_trainer_end_talk_session_v2", { conversation_session_id: sessionId })
    if (!result.ok) {
      setNotice(result.error?.message || "会話を終了できませんでした。")
      return
    }
    setSummary(result.data)
  }

  if (!scenario) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 sm:col-span-3">シナリオを選択</p>
        {SCENARIOS.map((item) => (
          <button key={item.id} type="button" onClick={() => start(item.id)} className="flex flex-col gap-1 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4 text-left">
            <span className="text-lg font-bold text-emerald-400">{item.label}</span>
            <span className="text-sm text-neutral-400">{item.description}</span>
          </button>
        ))}
        {notice ? <p className="text-sm text-amber-200 sm:col-span-3">{notice}</p> : null}
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <button type="button" onClick={() => { setScenario(null); setHistory([]); setSummary(null) }} className="text-left text-sm text-neutral-400">← シナリオを選び直す</button>
      <ul className="flex flex-col gap-2">
        {history.map((turn, index) => (
          <li key={`${turn.role}-${index}`} className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">{turn.role === "learner" ? "自分" : "相手"}: {turn.content}</li>
        ))}
      </ul>
      {summary ? (
        <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm">
          <p className="font-semibold">会話を終了しました</p>
          <p className="mt-2 text-neutral-300">{summary.turnCount} ターン / {summary.minutes} 分</p>
          <p className="mt-1 text-neutral-400">自発質問 {summary.selfQuestionCount} ・ フォロー {summary.followUpCount} ・ 聞き返し {summary.errorHandlingCount} ・ 停止 {summary.freezeCount} ・ 日本語 {summary.japaneseFallbackCount}</p>
          <p className="mt-1 text-neutral-400">新しい候補 {summary.newCandidateCount}</p>
          {summary.candidates?.map((candidate) => (
            <div key={candidate.candidateId} className="mt-3 rounded-lg bg-neutral-950 px-3 py-3">
              <p className="font-semibold">{candidate.pattern}</p>
              <p className="text-neutral-400">{candidate.meaning}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => review(candidate, "approved")} className="h-9 rounded-md bg-emerald-500 px-3 text-sm font-bold text-neutral-950">承認</button>
                <button type="button" onClick={() => review(candidate, "rejected")} className="h-9 rounded-md bg-neutral-800 px-3 text-sm">却下</button>
              </div>
            </div>
          ))}
        </article>
      ) : (
        <>
          <form onSubmit={send} className="flex gap-2">
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="英語で書く" className="h-12 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3" />
            <button type="submit" disabled={!draft.trim()} className="h-12 rounded-lg bg-emerald-500 px-4 font-bold text-neutral-950 disabled:bg-neutral-800 disabled:text-neutral-500">送る</button>
          </form>
          <button type="button" onClick={finish} className="h-11 rounded-md bg-neutral-800 text-sm font-semibold">会話を終了する</button>
        </>
      )}
      {notice ? <p className="text-sm text-amber-200">{notice}</p> : null}
    </section>
  )
}
