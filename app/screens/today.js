"use client"

import { useEffect } from "react"
import { useRpc } from "../ui/use-rpc"
import { useNav } from "../ui/nav"
import { capabilityLabel, purposeLabel, reasonLabel, trainingModeLabel, uiErrorMessage, weaknessLabel } from "../ui/labels"

function percent(value) {
  return value === null || value === undefined ? "未測定" : `${Math.round(value * 100)}%`
}

function seconds(value) {
  return value === null || value === undefined ? "未測定" : `${(value / 1000).toFixed(1)}秒`
}

export function Today() {
  const { navigate } = useNav()
  const plan = useRpc("skill_trainer_get_today_plan_v2")

  useEffect(() => {
    plan.trigger({})
  }, [])

  const data = plan.data
  const focus = data?.primaryFocus ?? null
  const items = data?.plan ?? []
  const route = data?.route ?? null

  return (
    <>
      {plan.loading && (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-6 py-16 text-neutral-300">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent" />
          <span>計画を作成中...</span>
        </div>
      )}

      {!plan.loading && plan.error !== null && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-6">
          <div className="flex gap-3">
            <span className="text-amber-400">⚠</span>
            <p className="text-sm text-neutral-300">
              {uiErrorMessage(plan.error, "今日の練習を読み込めませんでした。もう一度お試しください。")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => plan.trigger({})}
            className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-neutral-800 text-sm font-semibold"
          >
            ↻ 再試行
          </button>
        </div>
      )}

      {!plan.loading && plan.error === null && data && focus === null && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-16 text-center">
          <p className="font-semibold text-neutral-300">実行可能な課題がありません</p>
          <p className="mt-2 text-sm text-neutral-500">確認済みの練習問題が登録されているか確認してください。</p>
        </div>
      )}

      {!plan.loading && plan.error === null && focus !== null && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {focus.kind === "Diagnosis" ? "今の重点課題" : "まだ測れていない力"}
              </p>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                {purposeLabel(focus.purpose)}
              </span>
            </div>
            <p className="mt-3 text-xl font-bold text-neutral-100">{focus.skillLabel}</p>
            <p className="mt-1 text-sm text-neutral-400">{focus.canonicalForm}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-neutral-800 px-2.5 py-1">{capabilityLabel(focus.capability)}</span>
              {focus.weaknessType && (
                <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-amber-400">
                  {weaknessLabel(focus.weaknessType)}
                </span>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-neutral-950 px-3 py-2">
                <p className="text-xs text-neutral-500">成功率</p>
                <p className="font-semibold">
                  {percent(focus.metrics.estimate.successRate)} / 目標{" "}
                  {percent(focus.metrics.target.successRate)}
                </p>
              </div>
              <div className="rounded-lg bg-neutral-950 px-3 py-2">
                <p className="text-xs text-neutral-500">回答時間の中央値</p>
                <p className="font-semibold">
                  {seconds(focus.metrics.estimate.p50LatencyMs)} / 目標{" "}
                  {seconds(focus.metrics.target.p50LatencyMs)}
                </p>
              </div>
              <div className="rounded-lg bg-neutral-950 px-3 py-2">
                <p className="text-xs text-neutral-500">採点済み</p>
                <p className="font-semibold">{focus.metrics.estimate.gradedCount}件</p>
              </div>
              <div className="rounded-lg bg-neutral-950 px-3 py-2">
                <p className="text-xs text-neutral-500">判定の確かさ</p>
                <p className="font-semibold">{focus.metrics.estimate.confidence}%</p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-neutral-800 bg-neutral-900">
            <div className="border-b border-neutral-800 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">今日の練習</p>
            </div>
            <ul className="divide-y divide-neutral-800">
              {items.map((item) => (
                <li key={item.planItemId} className="px-4 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-emerald-400">
                      {purposeLabel(item.purpose)} · {trainingModeLabel(item.trainingMode)}
                    </p>
                    <span className="text-xs text-neutral-500">{item.dose}問</span>
                  </div>
                  <p className="mt-2 font-semibold text-neutral-100">今回の課題</p>
                  <p className="mt-1 text-sm text-neutral-300">{item.exercise.prompt}</p>
                  <p className="mt-2 text-xs text-neutral-500">理由: {reasonLabel(item.reasonCode)}</p>
                </li>
              ))}
            </ul>
          </section>

          {route && (route.recallReady.length > 0 || route.talkReady.length > 0 || route.quizConfusedPairs + route.quizUnmeasuredSkills > 0) && (
            <section className="rounded-xl border border-neutral-800 bg-neutral-900 lg:col-span-2">
              <div className="border-b border-neutral-800 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">次にやること</p>
              </div>
              <ul className="divide-y divide-neutral-800">
                {route.recallReady.map((skill) => (
                  <li key={`recall-${skill.skillKey}`}>
                    <button
                      type="button"
                      onClick={() => navigate(`/train?tab=practice&skill=${encodeURIComponent(skill.skillKey)}`)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-neutral-800/60"
                    >
                      <span>
                        <span className="block text-xs font-semibold text-emerald-400">選べるので、次は自分で言ってみる</span>
                        <span className="mt-1 block font-semibold text-neutral-100">{skill.form}</span>
                        <span className="block text-sm text-neutral-400">{skill.meaning}</span>
                      </span>
                      <span className="shrink-0 text-neutral-500">›</span>
                    </button>
                  </li>
                ))}
                {route.quizConfusedPairs + route.quizUnmeasuredSkills > 0 && (
                  <li>
                    <button
                      type="button"
                      onClick={() => navigate("/train")}
                      className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-neutral-800/60"
                    >
                      <span>
                        <span className="block text-xs font-semibold text-emerald-400">クイッククイズで確かめる</span>
                        <span className="mt-1 block text-sm text-neutral-300">
                          {route.quizConfusedPairs > 0 && `取り違えた組み合わせ ${route.quizConfusedPairs} 組`}
                          {route.quizConfusedPairs > 0 && route.quizUnmeasuredSkills > 0 && "、"}
                          {route.quizUnmeasuredSkills > 0 && `まだ書いて確かめていない表現 ${route.quizUnmeasuredSkills} 個`}
                        </span>
                      </span>
                      <span className="shrink-0 text-neutral-500">›</span>
                    </button>
                  </li>
                )}
                {route.talkReady.map((skill) => (
                  <li key={`talk-${skill.skillKey}`}>
                    <button
                      type="button"
                      onClick={() => navigate("/talk")}
                      className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-neutral-800/60"
                    >
                      <span>
                        <span className="block text-xs font-semibold text-emerald-400">自分で言えるので、会話で使ってみる</span>
                        <span className="mt-1 block font-semibold text-neutral-100">{skill.form}</span>
                        <span className="block text-sm text-neutral-400">{skill.meaning}</span>
                      </span>
                      <span className="shrink-0 text-neutral-500">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button
            type="button"
            onClick={() => navigate("/train?plan=today")}
            disabled={items.length === 0}
            className="flex h-14 items-center justify-center gap-2 rounded-md bg-emerald-500 text-base font-bold text-neutral-950 disabled:bg-neutral-800 disabled:text-neutral-500 lg:col-span-2"
          >
            練習を始める ›
          </button>
        </div>
      )}
    </>
  )
}
