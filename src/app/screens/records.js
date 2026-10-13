"use client"

import { useEffect, useState } from "react"
import { useRpc } from "../ui/use-rpc"
import {
  axisLabel,
  capabilityLabel,
  categoryLabel,
  diagnosisStatusLabel,
  gradingStatusLabel,
  observerLabel,
  uiErrorMessage,
  weaknessLabel,
} from "../ui/labels"

function percent(success, graded) {
  return `${Math.round((success / graded) * 100)}%`
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}秒`
}

function displayPhrase(phrase) {
  return phrase.replace(/\.\.\.\./g, "...")
}

function talkValue(summary) {
  if (summary.talkMinutes >= 5) return `${summary.talkMinutes}分`
  return `${summary.talkSessions}回`
}

function Metric({ label, value }) {
  return (
    <div className="rounded-md bg-neutral-800 px-2.5 py-2">
      <p className="text-[10px] text-neutral-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-neutral-100">{value}</p>
    </div>
  )
}

function ChoiceTextMetrics({ entry }) {
  const chooseRate = entry.choiceSuccess / entry.choiceGraded
  const writeWeak = entry.textGraded === 0 || entry.textSuccess / entry.textGraded < 0.8
  return (
    <>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <Metric label="選んで答える" value={`${entry.choiceSuccess}/${entry.choiceGraded}　${percent(entry.choiceSuccess, entry.choiceGraded)}`} />
        <Metric
          label="書いて答える"
          value={entry.textGraded === 0 ? "未測定" : `${entry.textSuccess}/${entry.textGraded}　${percent(entry.textSuccess, entry.textGraded)}`}
        />
      </div>
      {chooseRate >= 0.9 && writeWeak && (
        <p className="mt-1 text-sm text-amber-200">見れば分かるが、自力ではまだ出ない</p>
      )}
    </>
  )
}

export function Records() {
  const progress = useRpc("skill_trainer_get_progress_v2")
  const resetReview = useRpc("skill_trainer_reset_review_v2")
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [resetNote, setResetNote] = useState("")

  useEffect(() => {
    progress.trigger({})
  }, [])

  const data = progress.data
  const weekly = data?.weeklySummary

  return (
    <>
      {progress.loading && (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-6 py-16">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span>学習記録から再計算中...</span>
        </div>
      )}

      {!progress.loading && progress.error !== null && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-6">
          <div className="flex gap-3">
            <span className="text-amber-400">⚠</span>
            <p className="text-sm text-neutral-300">
              {uiErrorMessage(progress.error, "学習記録を読み込めませんでした。もう一度お試しください。")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => progress.trigger({})}
            className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-neutral-800 text-sm font-semibold"
          >
            ↻ 再試行
          </button>
        </div>
      )}

      {!progress.loading && progress.error === null && data && (
        <>
          {weekly && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">今週</p>
              <div className="mt-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4">
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="練習" value={`${weekly.practiceDays}日`} />
                  <Metric label="回答" value={`${weekly.answerCount}回`} />
                  <Metric label="会話" value={talkValue(weekly)} />
                </div>
                {weekly.latencyNowMs !== null && (
                  <div className="mt-4">
                    <p className="text-[10px] text-neutral-500">反応速度</p>
                    <p className="mt-0.5 text-lg font-semibold">
                      {weekly.latencyBeforeMs === null ? (
                        seconds(weekly.latencyNowMs)
                      ) : (
                        <>
                          {seconds(weekly.latencyBeforeMs)} → {seconds(weekly.latencyNowMs)}
                          {weekly.latencyNowMs < weekly.latencyBeforeMs && <span className="ml-2 text-emerald-400">↑</span>}
                        </>
                      )}
                    </p>
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Metric label="新しく安定" value={`+${weekly.newlyStableCount}`} />
                  <Metric label="克服" value={`+${weekly.overcomeCount}`} />
                </div>
                {weekly.newlyStableCount > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 text-sm text-neutral-300">
                    {weekly.newlyStable.map((item) => (
                      <li key={`stable-${item.phrase}`}>
                        {item.meaning}
                        <span className="ml-2 text-neutral-500">{displayPhrase(item.phrase)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {weekly.overcomeCount > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 text-sm text-emerald-400">
                    {weekly.overcome.map((item) => (
                      <li key={`overcome-${item.phrase}`}>
                        {item.meaning} ✓
                        <span className="ml-2 text-neutral-500">{displayPhrase(item.phrase)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {weekly.focus.length > 0 && (
                  <div className="mt-4 border-t border-neutral-800 pt-3">
                    <p className="text-[10px] text-neutral-500">現在の重点</p>
                    <ul className="mt-2 flex flex-col gap-2">
                      {weekly.focus.map((item) => (
                        <li key={`focus-${item.phrase}`}>
                          <p className="text-sm font-semibold">{item.meaning}</p>
                          <p className="text-sm text-neutral-400">{displayPhrase(item.phrase)}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <p className="text-xs font-semibold text-neutral-500">正解済み</p>
            <p className="mt-2 text-sm text-neutral-300">
              {Number(data.masteredPromptCount ?? 0)} 問は、正解したので繰り返していません。
            </p>
            {Number(data.recheckDueCount ?? 0) > 0 && (
              <p className="mt-2 text-sm text-emerald-200">
                再チェック待ち {data.recheckDueCount} 問。練習を開くと、覚えた問題を先に出します。
              </p>
            )}
            <button
              type="button"
              disabled={resetReview.loading}
              onClick={() => {
                resetReview.trigger({}).then(() => {
                  setResetNote("再チェックを始めます。練習を開くと、覚えた問題から出ます。")
                  progress.trigger({})
                })
              }}
              className="mt-4 flex h-11 w-full items-center justify-center rounded-md bg-neutral-800 text-sm font-semibold disabled:text-neutral-500"
            >
              {resetReview.loading ? "準備しています" : "覚えたものを再チェック"}
            </button>
            {resetNote !== "" && <p className="mt-2 text-sm text-neutral-300">{resetNote}</p>}
            {resetReview.error !== null && (
              <p className="mt-2 text-sm text-amber-300">{uiErrorMessage(resetReview.error, "再チェックを始められませんでした。")}</p>
            )}
          </section>

          {data.quickQuiz && (
            <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <p className="text-xs font-semibold text-neutral-500">クイッククイズ</p>
              <p className="mt-2 text-sm text-neutral-300">
                安定 {data.quickQuiz.stableCount} / {data.quickQuiz.itemCount} 問。間を空けて2回正解した問題だけ安定にします。
              </p>
              {Array.isArray(data.quickQuiz.pairs) && data.quickQuiz.pairs.length > 0 && (
                <ul className="mt-3 flex flex-col gap-3">
                  {data.quickQuiz.pairs.map((pair) => (
                    <li key={pair.pairId}>
                      <p className="text-sm font-semibold">
                        {pair.labelA} と {pair.labelB}
                        <span className="ml-2 text-xs font-normal text-neutral-500">{axisLabel(pair.confusionType)}</span>
                      </p>
                      <ChoiceTextMetrics entry={pair} />
                    </li>
                  ))}
                </ul>
              )}
              {Array.isArray(data.quickQuiz.skills) && data.quickQuiz.skills.length > 0 && (
                <ul className="mt-4 flex flex-col gap-3 border-t border-neutral-800 pt-4">
                  {data.quickQuiz.skills.map((skill) => (
                    <li key={skill.skillKey}>
                      <p className="text-sm font-semibold">
                        {skill.form}
                        <span className="ml-2 text-xs font-normal text-neutral-500">{skill.meaning}</span>
                      </p>
                      <ChoiceTextMetrics entry={skill} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {typeof data.confusionWatchCount === "number" && data.confusionWatchCount > 0 && (
            <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <p className="text-xs font-semibold text-neutral-500">混同の境界</p>
              <p className="mt-2 text-sm text-neutral-300">
                {data.confusionWatchCount} 対を監視しています。取り違えた対だけ、ここに正答数を出します。
              </p>
              {Array.isArray(data.confusionPairs) && data.confusionPairs.length > 0 && (
                <ul className="mt-3 flex flex-col gap-3">
                  {data.confusionPairs.map((pair) => (
                    <li key={pair.pairId}>
                      <p className="text-sm font-semibold">{pair.labelA} と {pair.labelB}</p>
                      <p className="mt-1 text-sm text-neutral-300">{axisLabel(pair.confusionType)}　境界 {pair.successCount}/{pair.gradedCount}</p>
                      <p className="mt-1 text-sm text-emerald-200">{pair.labelA}　{pair.keyA}　{pair.directionA}</p>
                      <p className="text-sm text-emerald-200">{pair.labelB}　{pair.keyB}　{pair.directionB}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {weekly && (
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className="flex h-11 w-full items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 text-sm font-semibold"
            >
              {detailsOpen ? "詳細を閉じる" : "詳細を見る"}
            </button>
          )}

          {(detailsOpen || !weekly) && (
            <>
              <section>
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">会話の記録</p>
                <div className="mt-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4">
                  <p className="text-2xl font-bold">{data.talkSummary.totalSessions}セッション</p>
                  <p className="mt-1 text-xs text-neutral-500">会話全体の記録です。個別の習得度へは直接加点しません。</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Metric label="自発質問" value={`${data.talkSummary.totalSelfQuestionCount}回`} />
                    <Metric label="話題を広げた回数" value={`${data.talkSummary.totalFollowUpCount}回`} />
                    <Metric label="聞き返し・言い直し" value={`${data.talkSummary.totalErrorHandlingCount}回`} />
                    <Metric label="完全停止" value={`${data.talkSummary.totalFreezeCount}回`} />
                    <Metric label="日本語に切り替えた回数" value={`${data.talkSummary.totalJapaneseFallbackCount}回`} />
                    <Metric
                      label="平均応答時間"
                      value={data.talkSummary.avgLatencyMs === null ? "未測定" : `${(data.talkSummary.avgLatencyMs / 1000).toFixed(1)}秒`}
                    />
                  </div>
                </div>
              </section>

              <section>
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">表現ごとの習得状況</p>
                <div className="mt-2 grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {data.skills.map((skill) => (
                    <div key={skill.skillKey} className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold">{skill.meaning}</p>
                          <p className="mt-1 text-sm text-neutral-400">{skill.canonicalForm}</p>
                        </div>
                        <span className="rounded-full bg-neutral-800 px-2 py-1 text-[11px] text-neutral-400">
                          {categoryLabel(skill.category)}
                        </span>
                      </div>

                      {skill.capabilities.map((capability) => (
                        <div key={capability.capability} className="mt-4 border-t border-neutral-800 pt-4">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold">{capabilityLabel(capability.capability)}</p>
                            <span className={`text-xs ${capability.status === "unmeasured" ? "text-neutral-500" : "text-emerald-400"}`}>
                              {capability.status === "unmeasured" ? "未測定" : "測定済み"}
                            </span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <Metric
                              label="成功数 / 採点数"
                              value={capability.status === "unmeasured" ? "未測定" : `${capability.successCount} / ${capability.gradedCount}件`}
                            />
                            <Metric
                              label="成功率"
                              value={capability.successRate === null ? "未測定" : `${Math.round(capability.successRate * 100)}%`}
                            />
                            <Metric
                              label="回答時間の中央値"
                              value={capability.p50LatencyMs === null ? "未測定" : `${(capability.p50LatencyMs / 1000).toFixed(1)}秒`}
                            />
                            <Metric label="判定の確かさ" value={`${capability.confidence}%`} />
                            <Metric label="観測窓" value={`${capability.evidenceWindowDays}日`} />
                            <Metric
                              label="最終観測"
                              value={capability.lastObservedAt === null ? "未測定" : new Date(capability.lastObservedAt).toLocaleDateString("ja-JP")}
                            />
                          </div>
                        </div>
                      ))}

                      {skill.diagnoses.length > 0 && (
                        <div className="mt-4 border-t border-neutral-800 pt-3">
                          <p className="text-xs text-neutral-500">重点課題</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {skill.diagnoses.map((diagnosis) => (
                              <span
                                key={diagnosis.diagnosisId}
                                className={`rounded-full px-2.5 py-1 text-xs ${
                                  diagnosis.status === "active" ? "bg-amber-400/10 text-amber-400" : "bg-neutral-800 text-neutral-500"
                                }`}
                              >
                                {weaknessLabel(diagnosis.type)} · {diagnosisStatusLabel(diagnosis.status)} · 重要度 {diagnosis.severity}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">採点の状態</p>
                <div className="mt-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4">
                  {data.graderStats.length === 0 ? (
                    <p className="text-sm text-neutral-500">採点記録なし</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {data.graderStats.map((stat) => (
                        <div key={`${stat.observerVersion}:${stat.status}`} className="flex items-center justify-between text-sm">
                          <span className="text-neutral-300">
                            {observerLabel(stat.observerVersion)} · {gradingStatusLabel(stat.status)}
                          </span>
                          <span className="font-semibold">{stat.count}件</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </>
  )
}
