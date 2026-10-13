"use client"

import { useEffect, useState } from "react"

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  return response.json()
}

export function AiPanel() {
  const [enabled, setEnabled] = useState(false)
  const [scenarioName, setScenarioName] = useState("teacher")
  const [history, setHistory] = useState([])
  const [draft, setDraft] = useState("")
  const [sentence, setSentence] = useState("")
  const [feedback, setFeedback] = useState(null)
  const [scene, setScene] = useState(null)
  const [notice, setNotice] = useState("")

  useEffect(() => {
    fetch("/api/ai/status")
      .then((response) => response.json())
      .then((body) => setEnabled(body.aiEnabled === true))
      .catch(() => setEnabled(false))
  }, [])

  async function sendTalk(event) {
    event.preventDefault()
    const result = await post("/api/ai/talk", { scenario: scenarioName, message: draft, history })
    if (!result.ok) {
      setNotice(result.error?.message || "会話を続けられませんでした。")
      return
    }
    setHistory([...history, { role: "learner", content: draft }, { role: "partner", content: result.data.reply }])
    setDraft("")
    setNotice("")
  }

  async function sendFeedback(event) {
    event.preventDefault()
    const result = await post("/api/ai/feedback", { text: sentence })
    if (!result.ok) {
      setNotice(result.error?.message || "添削できませんでした。")
      return
    }
    setFeedback(result.data)
    setNotice("")
  }

  async function sendScenario() {
    const result = await post("/api/ai/scenario", {})
    if (!result.ok) {
      setNotice(result.error?.message || "場面を作れませんでした。")
      return
    }
    setScene(result.data)
    setNotice("")
  }

  return (
    <section style={{ border: "1px solid #ccc", padding: "0.75rem 1rem", marginBottom: "1.5rem" }}>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>AI</h2>
      {enabled ? null : <p>無効です。Anthropic キーを設定すると使えます。</p>}
      <form onSubmit={sendTalk}>
        <h3 style={{ fontSize: "0.95rem" }}>会話</h3>
        <select value={scenarioName} disabled={!enabled} onChange={(event) => setScenarioName(event.target.value)}>
          <option value="teacher">教師</option>
          <option value="learner">学習者</option>
          <option value="free_talk">自由会話</option>
        </select>
        <ul>
          {history.map((turn, index) => (
            <li key={`${turn.role}-${index}`}>{turn.role === "learner" ? "自分" : "相手"}: {turn.content}</li>
          ))}
        </ul>
        <input value={draft} disabled={!enabled} onChange={(event) => setDraft(event.target.value)} placeholder="英語で書く" />
        <button type="submit" disabled={!enabled || draft.trim() === ""}>送る</button>
      </form>
      <form onSubmit={sendFeedback}>
        <h3 style={{ fontSize: "0.95rem" }}>文の添削</h3>
        <input value={sentence} disabled={!enabled} onChange={(event) => setSentence(event.target.value)} placeholder="添削したい英文" />
        <button type="submit" disabled={!enabled || sentence.trim() === ""}>見る</button>
        {feedback ? (
          <p>文法: {feedback.grammar} / 自然さ: {feedback.naturalness} / 書き換え: {feedback.rewrite}</p>
        ) : null}
      </form>
      <div>
        <h3 style={{ fontSize: "0.95rem" }}>場面</h3>
        <button type="button" disabled={!enabled} onClick={sendScenario}>1場面を作る</button>
        {scene ? <p>{scene.situation} / {scene.opener}</p> : null}
      </div>
      {notice ? <p>{notice}</p> : null}
    </section>
  )
}
