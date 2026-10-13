"use client"

import Link from "next/link"
import { useEffect } from "react"
import { ErrorCard, LoadingCard, Metric, SectionTitle } from "../../_components/ui"
import { useRpc } from "../../_hooks/use-rpc"
import { percent, seconds } from "../../_lib/format"
import { capabilityLabel, purposeLabel, reasonLabel, trainingModeLabel, weaknessLabel } from "../../_lib/labels"

function NextStep({ href, title, children }) {
  return (
    <li>
      <Link href={href} className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-neutral-800/60">
        <span>
          <span className="block text-xs font-semibold text-emerald-400">{title}</span>
          {children}
        </span>
        <span className="shrink-0 text-neutral-500">›</span>
      </Link>
    </li>
  )
}

function FocusCard({ focus }) {
  const { estimate, target } = focus.metrics
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>{focus.kind === "Diagnosis" ? "今の重点課題" : "まだ測れていない力"}</SectionTitle>
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">{purposeLabel(focus.purpose)}</span>
      </div>
      <p className="mt-3 text-xl font-bold text-neutral-100">{focus.skillLabel}</p>
      <p className="mt-1 text-sm text-neutral-400">{focus.canonicalForm}</p>
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-neutral-800 px-2.5 py-1">{capabilityLabel(focus.capability)}</span>
        {focus.weaknessType && <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-amber-400">{weaknessLabel(focus.weaknessType)}</span>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="成功率" value={`${percent(estimate.successRate)} / 目標 ${percent(target.successRate)}`} />
        <Metric label="回答時間の中央値" value={`${seconds(estimate.p50LatencyMs)} / 目標 ${seconds(target.p50LatencyMs)}`} />
        <Metric label="採点済み" value={`${estimate.gradedCount}件`} />
        <Metric label="判定の確かさ" value={`${estimate.confidence}%`} />
      </div>
    </section>
  )
}

function PlanList({ items }) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900">
      <div className="border-b border-neutral-800 px-4 py-3">
        <SectionTitle>今日の練習</SectionTitle>
      </div>
      <ul className="divide-y divide-neutral-800">
        {items.map((item) => (
          <li key={item.planItemId} className="px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-emerald-400">{purposeLabel(item.purpose)} · {trainingModeLabel(item.trainingMode)}</p>
              <span className="text-xs text-neutral-500">{item.dose}問</span>
            </div>
            <p className="mt-2 font-semibold text-neutral-100">今回の課題</p>
            <p className="mt-1 text-sm text-neutral-300">{item.exercise.prompt}</p>
            <p className="mt-2 text-xs text-neutral-500">理由: {reasonLabel(item.reasonCode)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RouteCard({ route }) {
  const quizCount = route.quizConfusedPairs + route.quizUnmeasuredSkills
  if (route.recallReady.length === 0 && route.talkReady.length === 0 && quizCount === 0) return null
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900 lg:col-span-2">
      <div className="border-b border-neutral-800 px-4 py-3">
        <SectionTitle>次にやること</SectionTitle>
      </div>
      <ul className="divide-y divide-neutral-800">
        {route.recallReady.map((skill) => (
          <NextStep key={`recall-${skill.skillKey}`} href={`/train?tab=practice&skill=${encodeURIComponent(skill.skillKey)}`} title="選べるので、次は自分で言ってみる">
            <span className="mt-1 block font-semibold text-neutral-100">{skill.form}</span>
            <span className="block text-sm text-neutral-400">{skill.meaning}</span>
          </NextStep>
        ))}
        {quizCount > 0 && (
          <NextStep href="/train" title="クイッククイズで確かめる">
            <span className="mt-1 block text-sm text-neutral-300">
              {route.quizConfusedPairs > 0 && `取り違えた組み合わせ ${route.quizConfusedPairs} 組`}
              {route.quizConfusedPairs > 0 && route.quizUnmeasuredSkills > 0 && "、"}
              {route.quizUnmeasuredSkills > 0 && `まだ書いて確かめていない表現 ${route.quizUnmeasuredSkills} 個`}
            </span>
          </NextStep>
        )}
        {route.talkReady.map((skill) => (
          <NextStep key={`talk-${skill.skillKey}`} href="/talk" title="自分で言えるので、会話で使ってみる">
            <span className="mt-1 block font-semibold text-neutral-100">{skill.form}</span>
            <span className="block text-sm text-neutral-400">{skill.meaning}</span>
          </NextStep>
        ))}
      </ul>
    </section>
  )
}

export function Today() {
  const plan = useRpc("skill_trainer_get_today_plan_v2")

  useEffect(() => {
    plan.trigger({})
  }, [])

  const data = plan.data
  const focus = data?.primaryFocus ?? null
  const items = data?.plan ?? []

  if (plan.loading) return <LoadingCard>計画を作成中...</LoadingCard>
  if (plan.error !== null) {
    return <ErrorCard message={plan.error} fallback="今日の練習を読み込めませんでした。もう一度お試しください。" onRetry={() => plan.trigger({})} />
  }
  if (!data) return null
  if (focus === null) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-16 text-center">
        <p className="font-semibold text-neutral-300">実行可能な課題がありません</p>
        <p className="mt-2 text-sm text-neutral-500">確認済みの練習問題が登録されているか確認してください。</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <FocusCard focus={focus} />
      <PlanList items={items} />
      {data.route && <RouteCard route={data.route} />}
      {items.length > 0 ? (
        <Link href="/train?plan=today" className="flex h-14 items-center justify-center gap-2 rounded-md bg-emerald-500 text-base font-bold text-neutral-950 lg:col-span-2">
          練習を始める ›
        </Link>
      ) : (
        <span className="flex h-14 items-center justify-center rounded-md bg-neutral-800 text-base font-bold text-neutral-500 lg:col-span-2">練習を始める ›</span>
      )}
    </div>
  )
}
