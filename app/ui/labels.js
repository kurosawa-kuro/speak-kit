export const SCREENS = [
  { id: "today", label: "今日" },
  { id: "practice", label: "練習" },
  { id: "talk", label: "会話" },
  { id: "records", label: "記録" },
]

export const QUIZ_FILTERS = [
  { id: "", label: "すべて" },
  { id: "meaning", label: "意味を選ぶ" },
  { id: "intent", label: "用途から選ぶ" },
  { id: "contrast", label: "表現を選ぶ" },
  { id: "form", label: "文を選ぶ", gated: true },
]

export function displayForm(canonical) {
  let out = ""
  let inSlot = false
  for (const ch of canonical || "") {
    if (ch === "{") {
      inSlot = true
      out += "..."
    } else if (ch === "}") {
      inSlot = false
    } else if (!inSlot) {
      out += ch
    }
  }
  return out
}

export const MODES = [
  { id: "controlled_recall", label: "思い出して答える", title: "思い出して答える力" },
  { id: "slot_replacement", label: "一部を入れ替える", title: "一部を入れ替える力" },
  { id: "contrast_drill", label: "表現を使い分ける", title: "表現を使い分ける力" },
  { id: "recognition", label: "意味を選ぶ", title: "意味を見分ける力" },
  { id: "free_production", label: "自由に英文を作る", title: "自由に英文を作る力" },
]

export const SCENARIOS = [
  { id: "teacher", label: "講師と話す", description: "英語教師が簡単な英語で助けながら会話を進める" },
  { id: "learner", label: "学習者同士で話す", description: "同じレベルの学習者としてカジュアルに雑談する" },
  { id: "free_talk", label: "自由に話す", description: "自然な会話パートナーと自由に話す" },
]

export const MODE_LABEL = {
  controlled_recall: "思い出して答える",
  slot_replacement: "一部を入れ替える",
  contrast_drill: "表現を使い分ける",
  recognition: "意味を選ぶ",
  free_production: "自由に英文を作る",
}

export const CAPABILITY_LABEL = {
  CONTROLLED_RECALL: "思い出して答える力",
  SLOT_REPLACEMENT: "入れ替えて応用する力",
  CONTRAST_SELECTION: "表現を使い分ける力",
  RECOGNITION: "意味を見分ける力",
  FREE_PRODUCTION: "自由に英文を作る力",
}

export function purposeLabel(value) {
  if (value === "Measure") return "測る"
  if (value === "Train") return "練習する"
  if (value === "Verify") return "確かめる"
  return "取り組む"
}

export function reasonLabel(value) {
  if (value === "insufficient_evidence" || value === "evidence_gap") return "まだ練習記録が少ないため"
  return "現在の力を確認するため"
}

export function percentRate(value) {
  return value === null || value === undefined ? "未測定" : `${Math.round(value * 100)}%`
}

export function seconds(value) {
  return value === null || value === undefined ? "未測定" : `${(value / 1000).toFixed(1)}秒`
}

export function rate(success, graded) {
  if (!graded) return "未測定"
  return `${success}/${graded}　${Math.round((success / graded) * 100)}%`
}
