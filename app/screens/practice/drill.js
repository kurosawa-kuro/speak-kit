"use client"

import { useEffect, useState } from "react"
import { post } from "../../ui/rpc"
import { MODES } from "../../ui/labels"

export function Drill({ target }) {
  const [mode, setMode] = useState(MODES[0].id)
  const [exercise, setExercise] = useState(null)
  const [answer, setAnswer] = useState("")
  const [notices, setNotices] = useState([])
  const [busy, setBusy] = useState(false)
  const [aiOn, setAiOn] = useState(true)
  const [left, setLeft] = useState("")
  const [right, setRight] = useState("")
  const [pairNote, setPairNote] = useState("")
  const [probe, setProbe] = useState(null)
  const [probeAnswer, setProbeAnswer] = useState("")
  async function load(nextMode, skillKey = target?.skillKey) {
    setAnswer("")
    const practice = await post("skill_trainer_get_practice_v2", {
      practice_id: crypto.randomUUID(),
      training_mode: nextMode,
      ...(skillKey ? { skill_key: skillKey } : {}),
    })
    setExercise(practice.ok ? practice.data : null)
  }
  useEffect(() => {
    const nextMode = target?.mode || MODES[0].id
    setMode(nextMode)
    load(nextMode, target?.skillKey)
    fetch("/api/ai/status").then((response) => response.json()).then((body) => setAiOn(Boolean(body.aiEnabled))).catch(() => setAiOn(false))
  }, [])
  const current = MODES.find((entry) => entry.id === mode)
  const card = exercise?.exercise
  async function submitAnswer(event) {
    event.preventDefault()
    if (!card || answer.trim() === "" || busy) return
    const typed = answer.trim()
    const question = card.prompt
    setBusy(true)
    const result = await post("skill_trainer_submit_attempt_v2", {
      response_mode: "free_text",
      attempt_id: crypto.randomUUID(),
      exercise_instance_id: card.exerciseInstanceId,
      answer_text: typed,
      latency_ms: 0,
    })
    setBusy(false)
    if (!result.ok) return
    const pending = result.data.gradingStatus === "pending"
    const success = result.data.outcome === "success"
    const ungraded = !pending && result.data.gradingStatus !== "graded"
    setNotices((currentNotices) => [{
      id: result.data.attemptId,
      title: pending ? "確認中" : success ? "成功" : ungraded ? "確認できませんでした" : "要復習",
      question,
      answer: typed,
      expected: result.data.expectedReference || card.expectedReference,
      detail: result.data.reason || (success ? "今回の言い方は合っています。" : "正解を見て、もう一度この形を出してみましょう。"),
      retry: ungraded,
    }, ...currentNotices].slice(0, 3))
    setAnswer("")
    load(mode)
  }
  return (
    <>
      <p className="text-xs font-semibold text-neutral-500">練習方法を選ぶ</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {MODES.map((entry) => (
          <button key={entry.id} type="button" onClick={() => { setMode(entry.id); load(entry.id) }} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${mode === entry.id ? "border-emerald-400 bg-emerald-500 text-neutral-950" : "border-neutral-800 bg-neutral-900 text-neutral-300"}`}>{entry.label}</button>
        ))}
      </div>
      {!aiOn ? (
        <div className="mt-4 rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          AI機能が現在利用できません。決定論的に正解と一致する回答はそのまま判定されますが、一致しない回答はAI採点待ち（確認できませんでした）のままになります。
        </div>
      ) : null}
      <article className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <p className="text-xs font-semibold text-emerald-400">{current?.title}</p>
        <p className="mt-4 text-xs text-neutral-500">{exercise?.skill?.meaning}</p>
        <h2 className="mt-2 text-xl font-bold leading-relaxed lg:text-2xl">{card?.prompt || "問題を読んでいます。"}</h2>
        <form onSubmit={submitAnswer}>
          <textarea value={answer} placeholder="回答を入力" onChange={(event) => setAnswer(event.target.value)} className="mt-5 min-h-32 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-4 text-base outline-none focus:border-emerald-500 lg:min-h-48 lg:text-lg" />
          <button type="submit" disabled={busy || answer.trim() === ""} className="mt-4 flex h-12 w-full items-center justify-center rounded-md bg-emerald-500 font-bold text-neutral-950 disabled:bg-neutral-800 disabled:text-neutral-500">{busy ? "確認しています" : "回答する"}</button>
        </form>
      </article>
      {notices.length > 0 ? (
        <section className="mt-4 flex flex-col gap-3" aria-label="これまでの回答">
          <h2 className="text-xs font-semibold text-neutral-500">これまでの回答</h2>
          {notices.map((notice) => (
            <article key={notice.id} className={`rounded-xl border bg-neutral-900 px-4 py-4 ${notice.title === "成功" ? "border-emerald-500/30" : notice.title === "要復習" ? "border-amber-500/40" : "border-neutral-800"}`}>
              <p className={`text-sm font-bold ${notice.title === "成功" ? "text-emerald-300" : notice.title === "要復習" ? "text-amber-200" : "text-neutral-300"}`}>{notice.title}</p>
              <div className="mt-3 flex flex-col gap-3 text-sm">
                <div><p className="text-xs font-semibold text-neutral-500">質問</p><p className="mt-1 font-semibold leading-relaxed">{notice.question}</p></div>
                <div><p className="text-xs font-semibold text-neutral-500">あなたの回答</p><p className="mt-1 rounded-md bg-neutral-950 px-3 py-2 leading-relaxed">{notice.answer}</p></div>
                <div><p className="text-xs font-semibold text-emerald-400">正解</p><p className="mt-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-base font-semibold leading-relaxed text-emerald-100">{notice.expected}</p></div>
                <div><p className="text-xs font-semibold text-neutral-500">解説</p><p className="mt-1 leading-relaxed text-neutral-300">{notice.detail}</p></div>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      <article className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <p>この二つが混ざる</p>
        <form onSubmit={async (event) => {
          event.preventDefault()
          const result = await post("skill_trainer_register_confusion_pair_v2", { label_a: left, label_b: right })
          if (result.ok && result.data?.probe) {
            setProbe(result.data.probe)
            setPairNote(`${result.data.labelA} と ${result.data.labelB} の確認問題を作りました。`)
          } else {
            setPairNote(result.error?.message || "確認問題を作れませんでした。")
          }
        }}>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <input value={left} placeholder="一つ目" onChange={(event) => setLeft(event.target.value)} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3" />
            <input value={right} placeholder="二つ目" onChange={(event) => setRight(event.target.value)} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3" />
          </div>
          <button type="submit" disabled={!left.trim() || !right.trim()} className="mt-3 h-11 w-full rounded-md bg-neutral-800 disabled:text-neutral-500">違いを作って確認する</button>
        </form>
        {pairNote ? <p className="mt-2 text-sm text-neutral-400">{pairNote}</p> : null}
        {probe ? (
          <form className="mt-4" onSubmit={async (event) => {
            event.preventDefault()
            const result = await post("skill_trainer_submit_attempt_v2", {
              response_mode: "confusion_probe",
              submission_id: crypto.randomUUID(),
              probe_id: probe.probeId,
              answer_text: probeAnswer,
            })
            setPairNote(result.ok ? (result.data.outcome === "success" ? "確認できました。" : `違います。正解は ${result.data.expectedReference}`) : result.error?.message)
            if (result.ok) setProbe(null)
          }}>
            <p className="text-sm font-semibold">{probe.prompt}</p>
            <input value={probeAnswer} onChange={(event) => setProbeAnswer(event.target.value)} placeholder="確認の回答" className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3" />
            <button type="submit" disabled={!probeAnswer.trim()} className="mt-3 h-11 w-full rounded-md bg-emerald-500 font-bold text-neutral-950 disabled:bg-neutral-800 disabled:text-neutral-500">確認する</button>
          </form>
        ) : null}
      </article>
    </>
  )
}
