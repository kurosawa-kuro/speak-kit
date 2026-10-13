"use client"

import { useEffect, useState } from "react"

const SCREENS = [
  { id: "today", label: "今日" },
  { id: "practice", label: "練習" },
  { id: "talk", label: "会話" },
  { id: "records", label: "記録" },
]

const QUIZ_FILTERS = [
  { id: "", label: "すべて" },
  { id: "meaning", label: "意味を選ぶ" },
  { id: "intent", label: "用途から選ぶ" },
  { id: "contrast", label: "表現を選ぶ" },
]

const MODES = [
  { id: "controlled_recall", label: "思い出して答える", title: "思い出して答える力" },
  { id: "slot_replacement", label: "一部を入れ替える", title: "一部を入れ替える力" },
  { id: "contrast_drill", label: "表現を使い分ける", title: "表現を使い分ける力" },
  { id: "recognition", label: "意味を選ぶ", title: "意味を見分ける力" },
  { id: "free_production", label: "自由に英文を作る", title: "自由に英文を作る力" },
]

const SCENARIOS = [
  { id: "teacher", label: "講師と話す", description: "英語教師が簡単な英語で助けながら会話を進める" },
  { id: "learner", label: "学習者同士で話す", description: "同じレベルの学習者としてカジュアルに雑談する" },
  { id: "free_talk", label: "自由に話す", description: "自然な会話パートナーと自由に話す" },
]

const MODE_LABEL = {
  controlled_recall: "思い出して答える",
  slot_replacement: "一部を入れ替える",
  contrast_drill: "表現を使い分ける",
  recognition: "意味を選ぶ",
  free_production: "自由に英文を作る",
}

const CAPABILITY_LABEL = {
  CONTROLLED_RECALL: "思い出して答える力",
  SLOT_REPLACEMENT: "入れ替えて応用する力",
  CONTRAST_SELECTION: "表現を使い分ける力",
  RECOGNITION: "意味を見分ける力",
  FREE_PRODUCTION: "自由に英文を作る力",
}

const AXIS = { DIRECTION: "方向", TIME: "時間", SUBJECT: "主体", INTENT: "意図", MEANING: "意味", REGISTER: "丁寧さ" }

function purposeLabel(value) {
  if (value === "Measure") return "測る"
  if (value === "Train") return "練習する"
  if (value === "Verify") return "確かめる"
  return "取り組む"
}

function reasonLabel(value) {
  if (value === "insufficient_evidence" || value === "evidence_gap") return "まだ練習記録が少ないため"
  return "現在の力を確認するため"
}

function percentRate(value) {
  return value === null || value === undefined ? "未測定" : `${Math.round(value * 100)}%`
}

function seconds(value) {
  return value === null || value === undefined ? "未測定" : `${(value / 1000).toFixed(1)}秒`
}

function rate(success, graded) {
  if (!graded) return "未測定"
  return `${success}/${graded}　${Math.round((success / graded) * 100)}%`
}

async function post(name, body) {
  const response = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  return response.json()
}

export function Shell() {
  const [screen, setScreen] = useState("today")
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-900">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="flex h-11 items-center rounded-md border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300">☰ アプリ一覧</span>
          <h1 className="text-lg font-bold">英会話学習</h1>
          <nav className="ml-auto flex gap-1 rounded-full border border-neutral-800 bg-neutral-950 p-1">
            {SCREENS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={screen === item.id ? "page" : undefined}
                onClick={() => setScreen(item.id)}
                className={`h-8 rounded-full px-4 text-sm font-semibold ${screen === item.id ? "bg-neutral-800 text-neutral-100" : "text-neutral-400"}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {screen === "today" ? <Today onPractice={() => setScreen("practice")} onTalk={() => setScreen("talk")} /> : null}
        {screen === "practice" ? <Practice /> : null}
        {screen === "talk" ? <Talk /> : null}
        {screen === "records" ? <Records /> : null}
      </main>
    </div>
  )
}

function Today({ onPractice, onTalk }) {
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
          <p className="mt-1 text-sm text-neutral-400">{focus.canonicalForm}</p>
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
                <button type="button" onClick={onPractice} className="flex w-full items-center justify-between px-4 py-4 text-left">
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
                <button type="button" onClick={onPractice} className="flex w-full items-center justify-between px-4 py-4 text-left">
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
      <button type="button" onClick={onPractice} className="flex h-14 items-center justify-center gap-2 rounded-md bg-emerald-500 text-base font-bold text-neutral-950 lg:col-span-2">練習を始める ›</button>
    </div>
  )
}

function Practice() {
  const [tab, setTab] = useState("quiz")
  return (
    <section>
      <div className="mb-3 flex items-center justify-between text-sm text-neutral-400">
        <span>← 戻る</span>
        <span>自由練習</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setTab("quiz")} className={`h-12 rounded-xl font-bold ${tab === "quiz" ? "bg-emerald-500 text-neutral-950" : "bg-neutral-800 text-neutral-300"}`}>クイッククイズ</button>
        <button type="button" onClick={() => setTab("drill")} className={`h-12 rounded-xl font-bold ${tab === "drill" ? "bg-emerald-500 text-neutral-950" : "bg-neutral-800 text-neutral-300"}`}>実践練習</button>
      </div>
      <div className="mt-4">{tab === "quiz" ? <Quiz /> : <Drill />}</div>
    </section>
  )
}

function Quiz() {
  const [filter, setFilter] = useState("")
  const [item, setItem] = useState(null)
  const [counts, setCounts] = useState({ stable: 0, total: 0 })
  const [picked, setPicked] = useState(null)
  const [result, setResult] = useState(null)
  const [shownAt, setShownAt] = useState(0)
  const [empty, setEmpty] = useState("")

  async function load(nextFilter = filter) {
    setPicked(null)
    setResult(null)
    const quiz = await post("skill_trainer_quiz_next_v1", nextFilter ? { quiz_type: nextFilter } : {})
    setItem(quiz.data?.item || null)
    setEmpty(quiz.data?.item ? "" : quiz.data?.message || "いま出せる問題はありません。")
    setCounts({ stable: quiz.data?.stableCount || 0, total: quiz.data?.itemCount || 0 })
    setShownAt(Date.now())
  }

  useEffect(() => { load("") }, [])

  async function choose(optionId) {
    if (!item || result) return
    setPicked(optionId)
    const submitted = await post("skill_trainer_submit_attempt_v2", {
      response_mode: "choice",
      submission_id: crypto.randomUUID(),
      item_key: item.itemKey,
      option_set_version: item.optionSetVersion,
      selected_option_id: optionId,
      option_order: item.options.map((option) => option.id),
      latency_ms: Math.max(0, Date.now() - shownAt),
    })
    if (submitted.ok) setResult(submitted.data)
  }

  useEffect(() => {
    function onKey(event) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (result && event.key === "Enter") load(filter)
      const index = Number(event.key) - 1
      if (!result && item && index >= 0 && index < item.options.length) choose(item.options[index].id)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const filterLabel = QUIZ_FILTERS.find((entry) => entry.id === filter)?.label
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {QUIZ_FILTERS.map((entry) => (
            <button key={entry.label} type="button" onClick={() => { setFilter(entry.id); load(entry.id) }} className={`rounded-md px-3 py-1 text-sm ${filter === entry.id ? "bg-emerald-500 font-bold text-neutral-950" : "bg-neutral-800 text-neutral-300"}`}>{entry.label}</button>
          ))}
        </div>
        <span className="text-sm text-emerald-400">安定 {counts.stable}/{counts.total}問</span>
      </div>
      <p className="mt-3 text-xs text-emerald-400">{filterLabel}</p>
      <article className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="text-2xl font-bold">{item?.prompt || empty || "問題を読んでいます。"}</h2>
        <div className="mt-4 flex flex-col gap-2">
          {item?.options?.map((option, index) => {
            const correct = result && option.text === result.correctText
            const wrong = result && option.id === picked && result.outcome === "failure"
            return (
              <button key={option.id} type="button" onClick={() => choose(option.id)} className={`flex items-center rounded-lg border bg-neutral-950 px-4 py-3 text-left ${correct ? "border-emerald-500" : wrong ? "border-red-500" : "border-neutral-800"}`}>
                <span className="mr-3 grid h-6 w-6 place-items-center rounded bg-neutral-800 text-xs">{index + 1}</span>
                {option.text}
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-xs text-neutral-500">{result ? (result.outcome === "success" ? "正解です。Enterで次へ進みます。" : `違います。正解は ${result.correctText}`) : "数字キー1〜4でも選べます。"}</p>
      </article>
    </>
  )
}

function Drill() {
  const [mode, setMode] = useState(MODES[0].id)
  const [exercise, setExercise] = useState(null)
  const [answer, setAnswer] = useState("")
  const [notices, setNotices] = useState([])
  const [busy, setBusy] = useState(false)
  const [aiOn, setAiOn] = useState(true)
  const [left, setLeft] = useState("")
  const [right, setRight] = useState("")
  const [pairNote, setPairNote] = useState("")
  async function load(nextMode) {
    setAnswer("")
    const practice = await post("skill_trainer_get_practice_v2", { practice_id: crypto.randomUUID(), training_mode: nextMode })
    setExercise(practice.ok ? practice.data : null)
  }
  useEffect(() => {
    load(MODES[0].id)
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
    const result = await post("ai/grade", {
      trainingMode: card.trainingMode,
      prompt: question,
      expectedReference: card.expectedReference,
      acceptedVariants: card.acceptedVariants,
      requiredDimensions: card.requiredDimensions,
      canonicalForm: exercise.skill?.canonicalForm,
      meaning: exercise.skill?.meaning,
      answer: typed,
    })
    setBusy(false)
    if (!result.ok) return
    setNotices((currentNotices) => [{
      id: crypto.randomUUID(),
      title: result.data.title,
      question,
      answer: typed,
      expected: result.data.expected,
      detail: result.data.detail,
      retry: result.data.retry,
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
          setPairNote(result.error?.message || "確認しました。")
        }}>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <input value={left} placeholder="一つ目" onChange={(event) => setLeft(event.target.value)} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3" />
            <input value={right} placeholder="二つ目" onChange={(event) => setRight(event.target.value)} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3" />
          </div>
          <button type="submit" disabled={!left.trim() || !right.trim()} className="mt-3 h-11 w-full rounded-md bg-neutral-800 disabled:text-neutral-500">違いを作って確認する</button>
        </form>
        {pairNote ? <p className="mt-2 text-sm text-neutral-400">{pairNote}</p> : null}
      </article>
    </>
  )
}

function Talk() {
  const [scenario, setScenario] = useState(null)
  const [history, setHistory] = useState([])
  const [draft, setDraft] = useState("")
  const [notice, setNotice] = useState("")

  async function start(next) {
    setScenario(next)
    setNotice("")
    const result = await post("ai/talk", { scenario: next, message: "" })
    if (!result.ok) {
      setNotice("無効です。Anthropic キーを設定すると使えます。")
      return
    }
    setHistory([{ role: "partner", content: result.data.reply }])
  }

  async function send(event) {
    event.preventDefault()
    const result = await post("ai/talk", { scenario, message: draft, history })
    if (!result.ok) {
      setNotice(result.error?.message || "会話を続けられませんでした。")
      return
    }
    setHistory([...history, { role: "learner", content: draft }, { role: "partner", content: result.data.reply }])
    setDraft("")
  }

  if (!scenario) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 sm:col-span-3">シナリオを選択</p>
        {SCENARIOS.map((item) => (
          <button key={item.id} type="button" onClick={() => start(item.id)} className="flex flex-col gap-1 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4 text-left">
            <span className="text-lg font-bold text-emerald-400">{item.label}</span>
            <span className="text-sm text-neutral-400">{item.description}</span>
          </button>
        ))}
        {notice ? <p className="text-sm text-amber-200 sm:col-span-3">{notice}</p> : null}
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <button type="button" onClick={() => { setScenario(null); setHistory([]) }} className="text-left text-sm text-neutral-400">← シナリオを選び直す</button>
      <ul className="flex flex-col gap-2">
        {history.map((turn, index) => (
          <li key={`${turn.role}-${index}`} className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">{turn.role === "learner" ? "自分" : "相手"}: {turn.content}</li>
        ))}
      </ul>
      <form onSubmit={send} className="flex gap-2">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="英語で書く" className="h-12 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3" />
        <button type="submit" disabled={!draft.trim()} className="h-12 rounded-lg bg-emerald-500 px-4 font-bold text-neutral-950 disabled:bg-neutral-800 disabled:text-neutral-500">送る</button>
      </form>
      {notice ? <p className="text-sm text-amber-200">{notice}</p> : null}
    </section>
  )
}

function Records() {
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
        <p className="mt-2 text-sm text-neutral-300">{data?.data?.masteredPromptCount ?? 0} 問は、正解したので繰り返していません。</p>
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
          </ul>
        </section>
      ) : null}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <p className="text-xs font-semibold text-neutral-500">混同の境界</p>
        <p className="mt-2 text-sm text-neutral-300">{data?.data?.confusionWatchCount ?? 0} 対を監視しています。取り違えた対だけ、ここに正答数を出します。</p>
      </section>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-md bg-neutral-800 px-2.5 py-2">
      <p className="text-[10px] text-neutral-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-neutral-100">{value}</p>
    </div>
  )
}
