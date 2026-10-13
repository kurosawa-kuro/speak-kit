"use client"

import { useEffect, useState } from "react"
import { post } from "../ui/rpc"
import { rate } from "../ui/labels"

function Metric({ label, value }) {
  return (
    <div className="rounded-md bg-neutral-800 px-2.5 py-2">
      <p className="text-[10px] text-neutral-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-neutral-100">{value}</p>
    </div>
  )
}

export function Records() {
  const [data, setData] = useState(null)
  const [note, setNote] = useState("")
  useEffect(() => {
    post("skill_trainer_get_progress_v2", {}).then(setData)
  }, [])
  const week = data?.data?.weeklySummary
  const quiz = data?.data?.quickQuiz
  async function recheck() {
    const result = await post("skill_trainer_reset_review_v2", {})
    setNote(result.ok ? "再チェックを始めます。練習を開くと、覚えた問題から出ます。" : result.error?.message)
  }
  return (
    <div className="flex flex-col gap-4">
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">今週</p>
        <div className="mt-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4">
          <div className="grid grid-cols-3 gap-2">
            <Metric label="練習" value={`${week?.practiceDays ?? 0}日`} />
            <Metric label="回答" value={`${week?.answerCount ?? 0}回`} />
            <Metric label="会話" value={`${week?.talkSessions ?? 0}回`} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="新しく安定" value={`+${week?.newlyStableCount ?? 0}`} />
            <Metric label="克服" value={`+${week?.overcomeCount ?? 0}`} />
          </div>
          {week?.focus?.length ? (
            <div className="mt-4 border-t border-neutral-800 pt-3">
              <p className="text-[10px] text-neutral-500">現在の重点</p>
              <ul className="mt-2 flex flex-col gap-2">
                {week.focus.map((item) => (
                  <li key={item.phrase}><p className="text-sm font-semibold">{item.meaning}</p><p className="text-sm text-neutral-400">{item.phrase}</p></li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <p className="text-xs font-semibold text-neutral-500">正解済み</p>
        <p className="mt-2 text-sm text-neutral-300">{data?.data?.masteredPromptCount ?? 0} 問は、正解したので繰り返していません。再チェック待ちは {data?.data?.recheckDueCount ?? 0} 問です。</p>
        <button type="button" onClick={recheck} className="mt-4 flex h-11 w-full items-center justify-center rounded-md bg-neutral-800 text-sm font-semibold">覚えたものを再チェック</button>
        {note ? <p className="mt-2 text-sm text-neutral-300">{note}</p> : null}
      </section>
      {quiz ? (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-xs font-semibold text-neutral-500">クイッククイズ</p>
          <p className="mt-2 text-sm text-neutral-300">安定 {quiz.stableCount} / {quiz.itemCount} 問。間を空けて2回正解した問題だけ安定にします。</p>
          <ul className="mt-4 flex flex-col gap-3 border-t border-neutral-800 pt-4">
            {quiz.skills?.map((skill) => {
              const chooseRate = skill.choiceGraded ? skill.choiceSuccess / skill.choiceGraded : 0
              const writeWeak = skill.textGraded === 0 || skill.textSuccess / skill.textGraded < 0.8
              return (
                <li key={skill.skillKey}>
                  <p className="text-sm font-semibold">{skill.form} <span className="ml-2 text-xs font-normal text-neutral-500">{skill.meaning}</span></p>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <Metric label="選んで答える" value={rate(skill.choiceSuccess, skill.choiceGraded)} />
                    <Metric label="書いて答える" value={skill.textGraded === 0 ? "未測定" : rate(skill.textSuccess, skill.textGraded)} />
                  </div>
                  {chooseRate >= 0.9 && writeWeak ? <p className="mt-1 text-sm text-amber-200">見れば分かるが、自力ではまだ出ない</p> : null}
                </li>
              )
            })}
            {quiz.pairs?.map((pair) => (
              <li key={pair.pairId}>
                <p className="text-sm font-semibold">{pair.labelA} / {pair.labelB}</p>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <Metric label="選んで答える" value={rate(pair.choiceSuccess, pair.choiceGraded)} />
                  <Metric label="書いて答える" value={pair.textGraded === 0 ? "未測定" : rate(pair.textSuccess, pair.textGraded)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <p className="text-xs font-semibold text-neutral-500">会話の記録</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Metric label="会話" value={`${data?.data?.talkSummary?.totalSessions ?? 0}回`} />
          <Metric label="自発質問" value={`${data?.data?.talkSummary?.totalSelfQuestionCount ?? 0}`} />
          <Metric label="フォロー" value={`${data?.data?.talkSummary?.totalFollowUpCount ?? 0}`} />
          <Metric label="聞き返し" value={`${data?.data?.talkSummary?.totalErrorHandlingCount ?? 0}`} />
          <Metric label="停止" value={`${data?.data?.talkSummary?.totalFreezeCount ?? 0}`} />
          <Metric label="日本語" value={`${data?.data?.talkSummary?.totalJapaneseFallbackCount ?? 0}`} />
        </div>
        <p className="mt-3 text-xs text-neutral-500">採点の出どころ</p>
        <ul className="mt-1 text-sm text-neutral-300">
          {(data?.data?.graderSources || []).map((source) => (
            <li key={source.source}>{source.source}: {source.count}</li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <p className="text-xs font-semibold text-neutral-500">混同の境界</p>
        <p className="mt-2 text-sm text-neutral-300">{data?.data?.confusionWatchCount ?? 0} 対を監視しています。取り違えた対だけ、ここに正答数を出します。</p>
      </section>
    </div>
  )
}
