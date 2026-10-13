"use client"

import { useEffect, useState } from "react"
import { post } from "../ui/rpc"
import { CAPABILITY_LABEL, MODE_LABEL, displayForm, percentRate, purposeLabel, reasonLabel, seconds } from "../ui/labels"

export function Today({ onPractice, onTalk }) {
  const [plan, setPlan] = useState(null)
  useEffect(() => {
    post("skill_trainer_get_today_plan_v2", {}).then(setPlan)
  }, [])
  const focus = plan?.data?.primaryFocus
  const items = plan?.data?.plan || []
  const route = plan?.data?.route
  const metrics = focus?.metrics
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      {focus ? (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{focus.kind === "Diagnosis" ? "今の重点課題" : "まだ測れていない力"}</p>
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">{purposeLabel(focus.purpose)}</span>
          </div>
          <p className="mt-3 text-xl font-bold">{focus.skillLabel}</p>
          <p className="mt-1 text-sm text-neutral-400">{displayForm(focus.canonicalForm)}</p>
          <div className="mt-4">
            <span className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs">{CAPABILITY_LABEL[focus.capability] || focus.capability}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-neutral-950 px-3 py-2"><p className="text-xs text-neutral-500">成功率</p><p className="font-semibold">{percentRate(metrics?.estimate?.successRate)} / 目標 {percentRate(metrics?.target?.successRate)}</p></div>
            <div className="rounded-lg bg-neutral-950 px-3 py-2"><p className="text-xs text-neutral-500">回答時間の中央値</p><p className="font-semibold">{seconds(metrics?.estimate?.p50LatencyMs)} / 目標 {seconds(metrics?.target?.p50LatencyMs)}</p></div>
            <div className="rounded-lg bg-neutral-950 px-3 py-2"><p className="text-xs text-neutral-500">採点済み</p><p className="font-semibold">{metrics?.estimate?.gradedCount ?? 0}件</p></div>
            <div className="rounded-lg bg-neutral-950 px-3 py-2"><p className="text-xs text-neutral-500">判定の確かさ</p><p className="font-semibold">{metrics?.estimate?.confidence ?? 0}%</p></div>
          </div>
        </section>
      ) : <p className="text-neutral-400">計画を作成中...</p>}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900">
        <div className="border-b border-neutral-800 px-4 py-3"><p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">今日の練習</p></div>
        <ul className="divide-y divide-neutral-800">
          {items.map((item) => (
            <li key={item.planItemId} className="px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-emerald-400">{purposeLabel(item.purpose)} · {MODE_LABEL[item.trainingMode] || item.trainingMode}</p>
                <span className="text-xs text-neutral-500">{item.dose}問</span>
              </div>
              <p className="mt-2 font-semibold">今回の課題</p>
              <p className="mt-1 text-sm text-neutral-300">{item.exercise?.prompt}</p>
              <p className="mt-2 text-xs text-neutral-500">理由: {reasonLabel(item.reasonCode)}</p>
            </li>
          ))}
        </ul>
      </section>
      {route ? (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900 lg:col-span-2">
          <div className="border-b border-neutral-800 px-4 py-3"><p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">次にやること</p></div>
          <ul className="divide-y divide-neutral-800">
            {route.recallReady?.map((skill) => (
              <li key={skill.skillKey}>
                <button type="button" onClick={() => onPractice({ tab: "drill", skillKey: skill.skillKey, mode: "controlled_recall" })} className="flex w-full items-center justify-between px-4 py-4 text-left">
                  <span>
                    <span className="block text-xs font-semibold text-emerald-400">選べるので、次は自分で言ってみる</span>
                    <span className="mt-1 block font-semibold">{skill.form}</span>
                    <span className="block text-sm text-neutral-400">{skill.meaning}</span>
                  </span>
                  <span className="text-neutral-500">›</span>
                </button>
              </li>
            ))}
            {(route.quizConfusedPairs || 0) + (route.quizUnmeasuredSkills || 0) > 0 ? (
              <li>
                <button type="button" onClick={() => onPractice({ tab: "quiz" })} className="flex w-full items-center justify-between px-4 py-4 text-left">
                  <span>
                    <span className="block text-xs font-semibold text-emerald-400">クイッククイズで確かめる</span>
                    <span className="mt-1 block text-sm text-neutral-300">
                      {route.quizConfusedPairs > 0 ? `取り違えた組み合わせ ${route.quizConfusedPairs} 組` : ""}
                      {route.quizUnmeasuredSkills > 0 ? `まだ書いて確かめていない表現 ${route.quizUnmeasuredSkills} 個` : ""}
                    </span>
                  </span>
                  <span className="text-neutral-500">›</span>
                </button>
              </li>
            ) : null}
            {route.talkReady?.map((skill) => (
              <li key={skill.skillKey}>
                <button type="button" onClick={onTalk} className="flex w-full items-center justify-between px-4 py-4 text-left">
                  <span>
                    <span className="block text-xs font-semibold text-emerald-400">自分で言えるので、会話で使ってみる</span>
                    <span className="mt-1 block font-semibold">{skill.form}</span>
                    <span className="block text-sm text-neutral-400">{skill.meaning}</span>
                  </span>
                  <span className="text-neutral-500">›</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <button type="button" onClick={() => onPractice({ tab: "drill", skillKey: items[0]?.skillKey, mode: items[0]?.trainingMode })} className="flex h-14 items-center justify-center gap-2 rounded-md bg-emerald-500 text-base font-bold text-neutral-950 lg:col-span-2">練習を始める ›</button>
    </div>
  )
}
