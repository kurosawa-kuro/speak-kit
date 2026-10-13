"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { AiUnavailableBanner, ErrorCard, LoadingCard } from "../../_components/ui"
import { useConfusionProbe } from "../../_hooks/use-confusion-probe"
import { useGradePoller } from "../../_hooks/use-grade-poller"
import { useRpc } from "../../_hooks/use-rpc"
import { uiErrorMessage } from "../../_lib/labels"
import { uuid } from "../../_lib/uuid"
import { AnswerHistory } from "./answer-history"
import { ExerciseCard } from "./exercise-card"
import { ModePicker } from "./mode-picker"
import { PairForm } from "./pair-form"

const UNFINISHED = new Set(["completed", "awaiting_grade"])

function gradeDetail(value) {
  if (value.verdict === "pending") return "結果はあとからここに出ます。"
  return uiErrorMessage(value.reason, value.verdict === "success" ? "今回の言い方は合っています。" : "正解を見て、もう一度この形を出してみましょう。")
}

/** 実践練習。planMode なら今日の計画を順に、ほかは選んだ練習方法の問題を 1 問ずつ出す。 */
export function Practice({ planMode, skillKey }) {
  const plan = useRpc("skill_trainer_get_today_plan_v2")
  const practice = useRpc("skill_trainer_get_practice_v2")
  const submit = useRpc("skill_trainer_submit_attempt_v2")
  const probeSubmit = useRpc("skill_trainer_submit_attempt_v2")
  const regrade = useRpc("skill_trainer_regrade_attempt_v2")
  const probe = useConfusionProbe()
  const [mode, setMode] = useState("controlled_recall")
  const [answer, setAnswer] = useState("")
  const [heldIds, setHeldIds] = useState([])
  const [notices, setNotices] = useState([])
  const shownAt = useRef(Date.now())
  const sessionId = useRef(uuid())
  const asked = useRef(new Map())

  const loadPractice = (nextMode = mode, skill = null) => {
    setAnswer("")
    submit.reset()
    probeSubmit.reset()
    shownAt.current = Date.now()
    practice.trigger({ practice_id: uuid(), training_mode: nextMode, ...(skill ? { skill_key: skill } : {}) })
  }
  const reload = () => (planMode ? plan.trigger({}) : loadPractice(mode))

  useEffect(() => {
    if (planMode) plan.trigger({})
    else loadPractice(mode, skillKey)
  }, [])

  const pushNotice = (notice) => {
    setNotices((current) => {
      const previous = current.find((entry) => entry.id === notice.id)
      return [
        { ...notice, difference: notice.difference ?? previous?.difference ?? null },
        ...current.filter((entry) => entry.id !== notice.id),
      ].slice(0, 3)
    })
  }

  const rememberGrade = (value) => {
    if (!value?.attemptId) return
    const context = asked.current.get(value.attemptId) ?? {}
    pushNotice({
      id: value.attemptId,
      verdict: value.verdict,
      canRegrade: value.canRegrade,
      question: context.question ?? "",
      answer: context.answer ?? "",
      expected: context.expected ?? String(value.expectedReference ?? ""),
      detail: gradeDetail(value),
      difference: value.confusion?.labelA ? value.confusion : null,
    })
  }

  const poller = useGradePoller((value) => {
    rememberGrade(value)
    probe.offer(value.confusion?.probe)
    if (planMode) plan.trigger({})
  })

  useEffect(() => {
    if (!probe.override) probe.offer(plan.data?.dueConfusion?.probe)
  }, [plan.data])

  const activePlanItem = useMemo(
    () => plan.data?.plan.find((item) => !UNFINISHED.has(item.status) && !heldIds.includes(item.exercise?.exerciseInstanceId ?? "")) ?? null,
    [plan.data, heldIds],
  )
  const exercise = planMode ? activePlanItem?.exercise : practice.data?.exercise
  const exerciseProbe = exercise?.confusionProbeId && !probe.isAnswered(exercise.confusionProbeId)
    ? { probeId: exercise.confusionProbeId, prompt: String(exercise.prompt ?? ""), expectedReference: String(exercise.expectedReference ?? "") }
    : null
  const incomingProbe = probe.override ?? exerciseProbe
  const capability = planMode ? activePlanItem?.capability : practice.data?.capability
  const skillLabel = incomingProbe ? "混同している二つを分ける" : planMode ? activePlanItem?.skillLabel : practice.data?.skill?.meaning
  const boundary = plan.data?.dueConfusion ?? practice.data?.confusion ?? notices.find((notice) => notice.difference)?.difference ?? null
  const source = planMode ? plan.data : practice.data
  const aiAvailable = source?.aiAvailable ?? true
  const busy = plan.loading || practice.loading || submit.loading
  const error = submit.error ?? probeSubmit.error ?? (planMode ? plan.error : practice.error)

  const afterAnswer = (nextProbe, sameProbeId = null) => {
    setAnswer("")
    shownAt.current = Date.now()
    if (nextProbe?.probeId && nextProbe.probeId !== sameProbeId && probe.offer(nextProbe)) return
    probe.clear()
    reload()
  }

  const submitProbe = async () => {
    const typed = answer.trim()
    const value = await probeSubmit.trigger({
      response_mode: "confusion_probe",
      submission_id: uuid(),
      probe_id: incomingProbe.probeId,
      answer_text: typed,
    })
    if (!value) return
    probe.markAnswered(incomingProbe.probeId)
    pushNotice({
      id: `${incomingProbe.probeId}:${typed}`,
      verdict: value.verdict,
      canRegrade: false,
      question: incomingProbe.prompt,
      answer: typed,
      expected: String(value.expectedReference ?? incomingProbe.expectedReference),
      detail: value.verdict === "success" ? "境界のこちら側は分かれました。" : "もう一方と混ざっています。違いを見て、別の文でもう一度。",
      difference: value.confusion?.labelA ? value.confusion : null,
    })
    afterAnswer(value.confusion?.probe, incomingProbe.probeId)
  }

  const submitExercise = async () => {
    const exerciseId = exercise.exerciseInstanceId
    const attemptId = uuid()
    const typed = answer.trim()
    asked.current.set(attemptId, { question: String(exercise.prompt ?? ""), answer: typed, expected: String(exercise.expectedReference ?? "") })
    const payload = {
      attempt_id: attemptId,
      exercise_instance_id: exerciseId,
      answer_text: typed,
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
    if (value.verdict === "pending") poller.watch(value.attemptId, payload)
    afterAnswer(value.confusion?.probe)
  }

  const submitAnswer = () => {
    if (answer.trim() === "") return
    if (incomingProbe) submitProbe()
    else if (exercise) submitExercise()
  }

  const retryGrade = async (attemptId) => {
    const value = await regrade.trigger({ regrade_id: uuid(), attempt_id: attemptId })
    if (!value) return
    poller.forget(attemptId)
    rememberGrade(value)
    if (planMode) plan.trigger({})
  }

  const awaiting = planMode && !activePlanItem && plan.data?.plan?.some((item) => item.status === "awaiting_grade")
  const finished = planMode && plan.data && !activePlanItem && !plan.data.plan?.some((item) => item.status !== "completed")

  return (
    <>
      {!aiAvailable && (
        <AiUnavailableBanner reason={source?.aiReason}>
          決定論的に正解と一致する回答はそのまま判定されますが、一致しない回答はAI採点待ち（確認できませんでした）のままになります。
        </AiUnavailableBanner>
      )}

      {!planMode && (
        <ModePicker
          mode={mode}
          onPick={(value) => {
            setMode(value)
            loadPractice(value)
          }}
        />
      )}

      {busy && !exercise && <LoadingCard>課題を準備中...</LoadingCard>}

      {error !== null && (
        <ErrorCard
          message={error}
          fallback="練習問題を読み込めませんでした。もう一度お試しください。"
          onRetry={() => {
            submit.reset()
            probeSubmit.reset()
            reload()
          }}
        />
      )}

      {!busy && error === null && awaiting && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-12 text-center text-neutral-300">前の回答を確認しています</div>
      )}

      {!busy && error === null && finished && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-12 text-center">
          <p className="text-lg font-bold text-emerald-300">今日の計画を完了しました</p>
          <Link href="/records" className="mt-5 inline-block rounded-md bg-emerald-500 px-5 py-3 font-bold text-neutral-950">学習記録を見る</Link>
        </div>
      )}

      {(incomingProbe || exercise) && (
        <ExerciseCard
          capability={capability}
          planItem={activePlanItem}
          skillLabel={skillLabel}
          boundary={incomingProbe ? boundary : null}
          prompt={incomingProbe?.prompt ?? exercise.prompt}
          answer={answer}
          onAnswer={setAnswer}
          onSubmit={submitAnswer}
          busy={busy}
          submitting={submit.loading || probeSubmit.loading}
        />
      )}

      <AnswerHistory notices={notices} onRegrade={retryGrade} regrading={regrade.loading} />

      <PairForm onProbe={(next) => probe.offer(next)} />
    </>
  )
}
