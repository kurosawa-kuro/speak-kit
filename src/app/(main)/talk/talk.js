"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AiUnavailableBanner, ErrorCard, Metric, Spinner } from "../../_components/ui"
import { useRpc } from "../../_hooks/use-rpc"
import { isSubmitEnter } from "../../_lib/keys"
import { TALK_SCENARIOS, uiErrorMessage } from "../../_lib/labels"
import { post } from "../../_lib/rpc"
import { uuid } from "../../_lib/uuid"

export function Talk() {
  const startSession = useRpc("skill_trainer_start_talk_session_v2")
  const sendMessage = useRpc("skill_trainer_send_talk_message_v2")
  const endSession = useRpc("skill_trainer_end_talk_session_v2")
  const review = useRpc("skill_trainer_review_candidate_v2")

  const [scenario, setScenario] = useState(null)
  const [conversationSessionId, setConversationSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState("")
  const [summary, setSummary] = useState(null)
  const [aiAvailable, setAiAvailable] = useState(true)
  const [aiReason, setAiReason] = useState(null)
  const [reviewed, setReviewed] = useState({})

  const sessionIdRef = useRef("")
  if (sessionIdRef.current === "") sessionIdRef.current = uuid()
  const focusAtRef = useRef(null)
  const openSessionRef = useRef(null)

  useEffect(() => {
    openSessionRef.current = conversationSessionId !== null && summary === null ? conversationSessionId : null
  }, [conversationSessionId, summary])

  useEffect(() => () => {
    const open = openSessionRef.current
    if (open) post("skill_trainer_end_talk_session_v2", { conversation_session_id: open }).catch(() => {})
  }, [])

  const handleStart = useCallback((next) => {
    setScenario(next)
    startSession.trigger({ scenario: next, session_id: sessionIdRef.current }).then((res) => {
      if (res) {
        setConversationSessionId(res.conversationSessionId)
        setMessages([{ turnIndex: res.assistantTurnIndex, role: "assistant", content: res.assistantMessage }])
        setAiAvailable(res.aiAvailable)
        setAiReason(res.aiReason ?? null)
        focusAtRef.current = Date.now()
      }
    })
  }, [startSession])

  const handleSend = useCallback(() => {
    if (conversationSessionId === null || sendMessage.loading || input.trim() === "") return
    const submitted = input.trim()
    const now = Date.now()
    const latencyMs = focusAtRef.current !== null ? now - focusAtRef.current : 0
    setInput("")
    setMessages((prev) => [...prev, { turnIndex: prev.length, role: "user", content: submitted }])
    sendMessage.trigger({
      conversation_session_id: conversationSessionId,
      turn_id: uuid(),
      message: submitted,
      latency_ms: Math.max(0, Math.round(latencyMs)),
    }).then((res) => {
      if (res) {
        setMessages((prev) => [...prev, { turnIndex: res.assistantTurnIndex, role: "assistant", content: res.assistantMessage }])
        setAiAvailable(res.aiAvailable)
        setAiReason(res.aiReason ?? null)
        focusAtRef.current = Date.now()
      }
    })
  }, [conversationSessionId, input, sendMessage])

  const handleEnd = useCallback(() => {
    if (conversationSessionId === null || endSession.loading) return
    endSession.trigger({ conversation_session_id: conversationSessionId }).then((res) => {
      if (res) setSummary(res)
    })
  }, [conversationSessionId, endSession])

  const handleReview = (candidate, decision) => {
    review.trigger({
      candidate_id: candidate.candidateId,
      decision,
      reviewed_by: "owner",
    }).then((res) => {
      if (res) setReviewed((current) => ({ ...current, [candidate.candidateId]: res.reviewState }))
    })
  }

  const handleRestart = useCallback(() => {
    sessionIdRef.current = uuid()
    setScenario(null)
    setConversationSessionId(null)
    setMessages([])
    setInput("")
    setSummary(null)
    setAiAvailable(true)
    setAiReason(null)
    setReviewed({})
  }, [])

  return (
    <>
      {scenario === null && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 sm:col-span-3">
            シナリオを選択
          </p>
          {TALK_SCENARIOS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => handleStart(s.value)}
              disabled={startSession.loading}
              className="flex flex-col gap-1 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4 text-left transition-colors hover:bg-neutral-800 active:bg-neutral-800/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex items-center gap-2 text-lg font-bold text-neutral-100">
                <span className="text-emerald-400">💬</span>
                {s.label}
              </span>
              <span className="text-sm text-neutral-400">{s.description}</span>
            </button>
          ))}
        </div>
      )}

      {scenario !== null && conversationSessionId === null && startSession.loading && (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-6 py-10 text-neutral-300">
          <Spinner />
          <span>会話を準備中...</span>
        </div>
      )}

      {scenario !== null && conversationSessionId === null && startSession.error !== null && (
        <ErrorCard message={startSession.error} fallback="会話を開始できませんでした。もう一度お試しください。" onRetry={handleRestart} retryLabel="シナリオを選び直す" />
      )}

      {conversationSessionId !== null && summary === null && (
        <div className="flex flex-col gap-3">
          {!aiAvailable && (
            <AiUnavailableBanner reason={aiReason}>会話は続けられますが、固定の返答になり、発話内容へのフィードバックは行われません。</AiUnavailableBanner>
          )}
          <div className="flex min-h-80 flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4 lg:min-h-[32rem] lg:px-6">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed lg:max-w-2xl lg:px-4 lg:py-3 lg:text-base ${
                    m.role === "user" ? "bg-emerald-500 text-neutral-950" : "bg-neutral-800 text-neutral-100"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sendMessage.loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-400">
                  <Spinner size="h-4 w-4" />
                  返答中...
                </div>
              </div>
            )}
          </div>

          {sendMessage.error !== null && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-red-400">
              {uiErrorMessage(sendMessage.error, "メッセージを送信できませんでした。もう一度お試しください。")}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => {
                if (focusAtRef.current === null) focusAtRef.current = Date.now()
              }}
              onKeyDown={(e) => {
                if (isSubmitEnter(e)) handleSend()
              }}
              placeholder="英語でメッセージを入力"
              className="h-12 flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-4 text-base text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={input.trim() === "" || sendMessage.loading}
              className="flex h-12 w-12 items-center justify-center rounded-md bg-emerald-500 text-neutral-950 transition-colors hover:bg-emerald-500/90 active:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
              aria-label="送信"
            >
              ➤
            </button>
          </div>

          <button
            type="button"
            onClick={handleEnd}
            disabled={endSession.loading}
            className="flex h-11 items-center justify-center gap-2 rounded-md bg-neutral-800 text-sm font-semibold text-neutral-100 transition-colors hover:bg-neutral-800/80 active:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {endSession.loading ? <Spinner size="h-4 w-4" /> : null}
            会話を終了する
          </button>
          {endSession.error !== null && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-red-400">
              {uiErrorMessage(endSession.error, "会話を終了できませんでした。もう一度お試しください。")}
            </div>
          )}
        </div>
      )}

      {summary !== null && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">会話の要約</p>
            <p className="mt-2 text-2xl font-bold text-neutral-100">
              {summary.turnCount}ターン・{Math.round(summary.durationSeconds / 60)}分
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
              <Metric large label="自発質問" value={summary.selfQuestionCount} />
              <Metric large label="フォローアップ" value={summary.followUpCount} />
              <Metric large label="聞き返し・言い直し" value={summary.errorHandlingCount} />
              <Metric large label="完全停止" value={summary.freezeCount} />
              <Metric large label="日本語に切り替えた回数" value={summary.japaneseFallbackCount} />
              <Metric large label="平均応答時間" value={summary.avgLatencyMs !== null ? `${Math.round(summary.avgLatencyMs / 1000)}秒` : "—"} />
            </div>
          </div>

          {summary.newCandidateCount > 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-400">
              言えなかった表現の候補を{summary.newCandidateCount}件検出しました。正式な学習項目と
              練習問題への追加は確認後に行われます。
            </div>
          )}

          {summary.candidates?.length > 0 && (
            <section className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4">
              <p className="text-xs font-semibold text-neutral-500">候補の確認</p>
              {summary.candidates.map((candidate) => {
                const state = reviewed[candidate.candidateId]
                return (
                  <div key={candidate.candidateId} className="rounded-lg bg-neutral-950 px-3 py-3 text-sm">
                    <p className="font-semibold text-neutral-100">{candidate.pattern}</p>
                    <p className="text-neutral-400">{candidate.meaning}</p>
                    {state ? (
                      <p className="mt-2 text-xs text-neutral-400">
                        {state === "approved" ? "承認して練習問題にしました。" : "却下しました。"}
                      </p>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <button type="button" disabled={review.loading} onClick={() => handleReview(candidate, "approved")} className="h-9 rounded-md bg-emerald-500 px-3 text-sm font-bold text-neutral-950 disabled:opacity-60">承認</button>
                        <button type="button" disabled={review.loading} onClick={() => handleReview(candidate, "rejected")} className="h-9 rounded-md bg-neutral-800 px-3 text-sm disabled:opacity-60">却下</button>
                      </div>
                    )}
                  </div>
                )
              })}
              {review.error !== null && (
                <p className="text-sm text-red-400">{uiErrorMessage(review.error, "候補を確認できませんでした。もう一度お試しください。")}</p>
              )}
            </section>
          )}

          <button
            type="button"
            onClick={handleRestart}
            className="flex h-12 items-center justify-center gap-2 rounded-md bg-emerald-500 text-base font-semibold text-neutral-950 transition-colors hover:bg-emerald-500/90 active:bg-emerald-600"
          >
            もう一度話す
          </button>
        </div>
      )}
    </>
  )
}
