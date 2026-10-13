"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRpc } from "../ui/use-rpc"
import { useNav } from "../ui/nav"
import { QuickQuiz } from "./quiz"
import { capabilityLabel, purposeLabel, reasonLabel, trainingModeLabel, uiErrorMessage } from "../ui/labels"

const modes = [
  { value: "controlled_recall", label: trainingModeLabel("controlled_recall") },
  { value: "slot_replacement", label: trainingModeLabel("slot_replacement") },
  { value: "contrast_drill", label: trainingModeLabel("contrast_drill") },
  { value: "recognition", label: trainingModeLabel("recognition") },
  { value: "free_production", label: trainingModeLabel("free_production") },
]

function uuid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function Spinner({ size = "h-5 w-5" }) {
  return <span className={`${size} animate-spin rounded-full border-2 border-current border-t-transparent`} />
}

export function Train() {
  const { navigate, searchParams } = useNav()
  const planMode = searchParams.get("plan") === "today"
  const plan = useRpc("skill_trainer_get_today_plan_v2")
  const practice = useRpc("skill_trainer_get_practice_v2")
  const submit = useRpc("skill_trainer_submit_attempt_v2")
  const gradePoll = useRpc("skill_trainer_submit_attempt_v2")
  const regrade = useRpc("skill_trainer_regrade_attempt_v2")
  const [surface, setSurface] = useState("quiz")
  const [mode, setMode] = useState("controlled_recall")
  const [answer, setAnswer] = useState("")
  const [heldIds, setHeldIds] = useState([])
  const [notices, setNotices] = useState([])
  const [probeOverride, setProbeOverride] = useState(null)
  const [mixA, setMixA] = useState("")
  const [mixB, setMixB] = useState("")
  const probeSubmit = useRpc("skill_trainer_submit_attempt_v2")
  const registerPair = useRpc("skill_trainer_register_confusion_pair_v2")
  const shownAt = useRef(Date.now())
  const sessionId = useRef(uuid())
  const pendingPayloads = useRef(new Map())
  const attemptContext = useRef(new Map())
  const pollBusy = useRef(false)

  const loadPractice = (nextMode = mode, skillKey = null) => {
    setAnswer("")
    shownAt.current = Date.now()
    practice.trigger({ practice_id: uuid(), training_mode: nextMode, ...(skillKey ? { skill_key: skillKey } : {}) })
  }

  const rememberGrade = (value) => {
    if (!value?.attemptId) return
    const pending = value.gradingStatus === "pending"
    const success = value.outcome === "success"
    const ungraded = !pending && value.gradingStatus !== "graded"
    const context = attemptContext.current.get(value.attemptId)
    setNotices((current) => {
      const previous = current.find((notice) => notice.id === value.attemptId)
      return [
        {
          id: value.attemptId,
          title: pending ? "確認中" : success ? "成功" : ungraded ? "確認できませんでした" : "要復習",
          question: context?.question || previous?.question || "",
          answer: context?.answer || previous?.answer || "",
          expected: context?.expected || previous?.expected || "",
          detail: pending
            ? "結果はあとからここに出ます。"
            : uiErrorMessage(value.reason, success ? "今回の言い方は合っています。" : "正解を見て、もう一度この形を出してみましょう。"),
          pending,
          retry: ungraded,
          difference: value.confusion?.labelA ? value.confusion : previous?.difference ?? null,
        },
        ...current.filter((notice) => notice.id !== value.attemptId),
      ].slice(0, 3)
    })
  }

  useEffect(() => {
    if (planMode) plan.trigger({})
  }, [planMode])

  const openPractice = (nextMode, skillKey = null) => {
    setSurface("practice")
    setMode(nextMode)
    loadPractice(nextMode, skillKey)
  }

  useEffect(() => {
    if (planMode || searchParams.get("tab") !== "practice") return
    openPractice("controlled_recall", searchParams.get("skill"))
  }, [])

  const speakAfterQuiz = (promotion) => {
    openPractice("controlled_recall", promotion.kind === "skill" ? promotion.skillKey : null)
  }

  const showPractice = planMode || surface === "practice"

  useEffect(() => {
    const due = plan.data?.dueConfusion?.probe
    if (!probeOverride && due?.probeId) {
      setProbeOverride({ probeId: due.probeId, prompt: due.prompt, expectedReference: due.expectedReference })
    }
  }, [plan.data, probeOverride])

  const activePlanItem = useMemo(
    () =>
      plan.data?.plan.find(
        (item) =>
          item.status !== "completed" &&
          item.status !== "awaiting_grade" &&
          !heldIds.includes(item.exercise?.exerciseInstanceId ?? ""),
      ) ?? null,
    [plan.data, heldIds],
  )
  const exercise = planMode ? activePlanItem?.exercise : practice.data?.exercise
  const incomingProbe = probeOverride ?? (exercise?.confusionProbeId
    ? { probeId: exercise.confusionProbeId, prompt: String(exercise.prompt ?? ""), expectedReference: String(exercise.expectedReference ?? "") }
    : null)
  const capability = planMode ? activePlanItem?.capability : practice.data?.capability
  const skillLabel = incomingProbe ? "混同している二つを分ける" : planMode ? activePlanItem?.skillLabel : practice.data?.skill?.meaning
  const boundary = plan.data?.dueConfusion ?? practice.data?.confusion ?? notices.find((notice) => notice.difference)?.difference ?? null
  const aiAvailable = planMode ? plan.data?.aiAvailable ?? true : practice.data?.aiAvailable ?? true
  const busy = plan.loading || practice.loading || submit.loading
  const error = submit.error ?? (planMode ? plan.error : practice.error)

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextPending = pendingPayloads.current.entries().next().value
      if (!nextPending || pollBusy.current) return
      const [attemptId, payload] = nextPending
      pollBusy.current = true
      gradePoll.trigger(payload).then((value) => {
        if (!value || value.attemptId !== attemptId || value.gradingStatus === "pending") return
        pendingPayloads.current.delete(attemptId)
        rememberGrade(value)
        const nextProbe = value.confusion?.probe
        if (nextProbe?.probeId) {
          setProbeOverride({ probeId: nextProbe.probeId, prompt: nextProbe.prompt, expectedReference: nextProbe.expectedReference })
        }
        if (planMode) plan.trigger({})
      }).finally(() => {
        pollBusy.current = false
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [planMode])

  const submitAnswer = async () => {
    if (answer.trim() === "") return
    if (incomingProbe) {
      const typed = answer.trim()
      const question = incomingProbe.prompt
      const value = await probeSubmit.trigger({
        response_mode: "confusion_probe",
        submission_id: uuid(),
        probe_id: incomingProbe.probeId,
        answer_text: typed,
      })
      if (!value) return
      const success = value.outcome === "success"
      setNotices((current) => [
        {
          id: incomingProbe.probeId + typed,
          title: success ? "成功" : "要復習",
          question,
          answer: typed,
          expected: String(value.expectedReference ?? incomingProbe.expectedReference),
          detail: success ? "境界のこちら側は分かれました。" : "もう一方と混ざっています。違いを見て、別の文でもう一度。",
          pending: false,
          retry: false,
          difference: value.confusion?.labelA ? value.confusion : null,
        },
        ...current,
      ].slice(0, 3))
      setAnswer("")
      shownAt.current = Date.now()
      const nextProbe = value.confusion?.probe
      if (nextProbe?.probeId && nextProbe.probeId !== incomingProbe.probeId) {
        setProbeOverride({ probeId: nextProbe.probeId, prompt: nextProbe.prompt, expectedReference: nextProbe.expectedReference })
      } else {
        setProbeOverride(null)
        if (planMode) plan.trigger({})
        else loadPractice(mode)
      }
      return
    }
    if (!exercise) return
    const exerciseId = exercise.exerciseInstanceId
    const attemptId = uuid()
    const question = String(exercise.prompt ?? "")
    const typed = answer.trim()
    attemptContext.current.set(attemptId, {
      question,
      answer: typed,
      expected: String(exercise.expectedReference ?? ""),
    })
    const payload = {
      attempt_id: attemptId,
      exercise_instance_id: exerciseId,
      answer_text: answer.trim(),
      latency_ms: Math.max(0, Date.now() - shownAt.current),
      session_id: sessionId.current,
      occurred_at: new Date().toISOString(),
      defer_unknown: true,
    }
    if (planMode) setHeldIds((current) => [...current, exerciseId])
    const value = await submit.trigger(payload)
    if (!value) {
      if (planMode) setHeldIds((current) => current.filter((id) => id !== exerciseId))
      return
    }
    rememberGrade(value)
    if (value.gradingStatus === "pending") pendingPayloads.current.set(value.attemptId, payload)
    setAnswer("")
    shownAt.current = Date.now()
    const nextProbe = value.confusion?.probe
    if (nextProbe?.probeId) {
      setProbeOverride({ probeId: nextProbe.probeId, prompt: nextProbe.prompt, expectedReference: nextProbe.expectedReference })
    } else if (planMode) plan.trigger({})
    else loadPractice(mode)
  }

  const retryGrade = async (attemptId) => {
    const value = await regrade.trigger({ regrade_id: uuid(), attempt_id: attemptId })
    if (!value) return
    pendingPayloads.current.delete(attemptId)
    rememberGrade(value)
    if (planMode) plan.trigger({})
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => navigate(planMode ? "/" : "/today")} className="flex items-center gap-2 text-sm text-neutral-400">
          ← 戻る
        </button>
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {planMode ? "今日の練習" : "自由練習"}
        </span>
      </div>

      {!planMode && (
        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="練習の種類">
          {[
            ["quiz", "クイッククイズ"],
            ["practice", "実践練習"],
          ].map(([value, label]) => (
            <button
              type="button"
              role="tab"
              key={value}
              aria-selected={surface === value}
              onClick={() => (value === "quiz" ? setSurface("quiz") : openPractice(mode))}
              className={`h-12 rounded-lg border text-sm font-bold transition-colors ${
                surface === value
                  ? "border-emerald-400 bg-emerald-500 text-neutral-950"
                  : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {showPractice && !aiAvailable && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3">
          <span className="text-amber-400">⚠</span>
          <p className="text-sm text-amber-200">
            AI機能が現在利用できません。決定論的に正解と一致する回答はそのまま判定されますが、
            一致しない回答はAI採点待ち（確認できませんでした）のままになります。
          </p>
        </div>
      )}

      {!planMode && surface === "quiz" && <QuickQuiz onSpeak={speakAfterQuiz} />}

      {!planMode && surface === "practice" && (
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-neutral-500">練習方法を選ぶ</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {modes.map((item) => (
              <button
                type="button"
                key={item.value}
                onClick={() => {
                  setMode(item.value)
                  loadPractice(item.value)
                }}
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
      )}

      {showPractice && busy && !exercise && (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-16 text-neutral-400">
          <Spinner /> 課題を準備中...
        </div>
      )}

      {showPractice && error !== null && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
          <div className="flex gap-3 text-sm text-amber-200">
            <span>⚠</span>
            {uiErrorMessage(error, "練習問題を読み込めませんでした。もう一度お試しください。")}
          </div>
          <button type="button" onClick={() => (planMode ? plan.trigger({}) : loadPractice(mode))} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-neutral-800 text-sm font-semibold">
            ↻ 再試行
          </button>
        </div>
      )}

      {!busy && !error && planMode && !activePlanItem && plan.data?.plan?.some((item) => item.status === "awaiting_grade") && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-12 text-center text-neutral-300">
          前の回答を確認しています
        </div>
      )}

      {!busy && !error && planMode && plan.data && !activePlanItem && !plan.data.plan?.some((item) => item.status !== "completed") && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-12 text-center">
          <p className="text-lg font-bold text-emerald-300">今日の計画を完了しました</p>
          <button type="button" onClick={() => navigate("/progress")} className="mt-5 rounded-md bg-emerald-500 px-5 py-3 font-bold text-neutral-950">学習記録を見る</button>
        </div>
      )}

      {showPractice && (incomingProbe || exercise) && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-emerald-400">{capabilityLabel(capability)}</span>
            {activePlanItem && <span className="rounded-full bg-neutral-800 px-2.5 py-1">{purposeLabel(activePlanItem.purpose)} · {reasonLabel(activePlanItem.reasonCode)}</span>}
          </div>
          <p className="mt-4 text-xs text-neutral-500">{skillLabel}</p>
          {incomingProbe && boundary?.labelA && (
            <div className="mt-3 text-sm text-emerald-100">
              <p>{boundary.labelA}　{boundary.keyA}　{boundary.directionA}</p>
              <p>{boundary.labelB}　{boundary.keyB}　{boundary.directionB}</p>
            </div>
          )}
          <p className="mt-2 text-xl font-bold leading-relaxed lg:text-2xl">{incomingProbe?.prompt ?? exercise.prompt}</p>
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="回答を入力"
            className="mt-5 min-h-32 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-4 text-base outline-none focus:border-emerald-500 lg:min-h-48 lg:text-lg"
          />
          <button type="button" onClick={submitAnswer} disabled={busy || answer.trim() === ""} className="mt-4 flex h-12 w-full items-center justify-center rounded-md bg-emerald-500 font-bold text-neutral-950 disabled:bg-neutral-800 disabled:text-neutral-500">
            {submit.loading ? <Spinner /> : "回答する"}
          </button>
        </section>
      )}

      {showPractice && notices.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="これまでの回答">
          <h2 className="text-xs font-semibold text-neutral-500">これまでの回答</h2>
          {notices.map((notice) => (
            <article
              key={notice.id}
              className={`rounded-xl border bg-neutral-900 px-4 py-4 ${
                notice.pending
                  ? "border-neutral-800"
                  : notice.title === "成功"
                    ? "border-emerald-500/30"
                    : "border-amber-500/40"
              }`}
            >
              <p
                className={`text-sm font-bold ${
                  notice.pending ? "text-neutral-300" : notice.title === "成功" ? "text-emerald-300" : "text-amber-200"
                }`}
              >
                {notice.title}
              </p>
              <div className="mt-3 flex flex-col gap-3 text-sm">
                <div>
                  <p className="text-xs font-semibold text-neutral-500">質問</p>
                  <p className="mt-1 font-semibold leading-relaxed">{notice.question}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-neutral-500">あなたの回答</p>
                  <p className="mt-1 rounded-md bg-neutral-950 px-3 py-2 leading-relaxed">{notice.answer}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-emerald-400">正解</p>
                  <p className="mt-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-base font-semibold leading-relaxed text-emerald-100">
                    {notice.expected}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-neutral-500">解説</p>
                  <p className="mt-1 leading-relaxed text-neutral-300">{notice.detail}</p>
                </div>
                {notice.difference && (
                  <div>
                    <p className="text-xs font-semibold text-neutral-500">違い</p>
                    <p className="mt-1 text-emerald-100">{notice.difference.labelA}　{notice.difference.keyA}　{notice.difference.directionA}</p>
                    <p className="text-emerald-100">{notice.difference.labelB}　{notice.difference.keyB}　{notice.difference.directionB}</p>
                  </div>
                )}
              </div>
              {notice.retry && (
                <button type="button" onClick={() => retryGrade(notice.id)} disabled={regrade.loading} className="mt-3 h-10 w-full rounded-md bg-amber-400 text-sm font-bold text-neutral-950">
                  再判定する
                </button>
              )}
            </article>
          ))}
        </section>
      )}

      {showPractice && (
        <form
          className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (mixA.trim() === "" || mixB.trim() === "") return
            registerPair.trigger({ label_a: mixA.trim(), label_b: mixB.trim() }).then((value) => {
              const nextProbe = value?.probe
              if (nextProbe?.probeId) {
                setProbeOverride({ probeId: nextProbe.probeId, prompt: nextProbe.prompt, expectedReference: nextProbe.expectedReference })
              }
              setMixA("")
              setMixB("")
            })
          }}
        >
          <p className="text-xs font-semibold text-neutral-500">この二つが混ざる</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input value={mixA} onChange={(event) => setMixA(event.target.value)} placeholder="一つ目" className="h-11 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm outline-none focus:border-emerald-500" />
            <input value={mixB} onChange={(event) => setMixB(event.target.value)} placeholder="二つ目" className="h-11 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm outline-none focus:border-emerald-500" />
          </div>
          <button type="submit" disabled={registerPair.loading || mixA.trim() === "" || mixB.trim() === ""} className="mt-3 flex h-11 w-full items-center justify-center rounded-md bg-neutral-800 text-sm font-semibold disabled:text-neutral-500">
            {registerPair.loading ? <Spinner size="h-4 w-4" /> : "違いを作って確認する"}
          </button>
        </form>
      )}
    </>
  )
}
