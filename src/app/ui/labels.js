const TRAINING_MODE_LABELS = {
  controlled_recall: "思い出して答える",
  slot_replacement: "一部を入れ替える",
  contrast_drill: "表現を使い分ける",
  recognition: "意味を選ぶ",
  free_production: "自由に英文を作る",
}

const CAPABILITY_LABELS = {
  CONTROLLED_RECALL: "思い出して答える力",
  SLOT_REPLACEMENT: "入れ替えて応用する力",
  CONTRAST_SELECTION: "表現を使い分ける力",
  RECOGNITION: "意味を見分ける力",
  FREE_PRODUCTION: "自由に英文を作る力",
  CONVERSATION_USAGE: "会話で使う力",
  RETENTION_1D: "1日後の定着",
  RETENTION_7D: "7日後の定着",
  RETENTION_30D: "30日後の定着",
}

const WEAKNESS_LABELS = {
  CONTROLLED_RETRIEVAL: "思い出すのに時間がかかる",
  LATENCY: "答えるまでが遅い",
  MEANING: "意味の理解",
  INTENT: "場面に合う表現",
  FORM_SELECTION: "表現の使い分け",
  RETENTION: "定着の確認",
}

const CATEGORY_LABELS = {
  ACTION: "行動・依頼",
  ERROR_HANDLING: "聞き返し・言い直し",
  OUTPUT: "説明・発話",
  QUERY: "質問",
  TIME: "時制・時間",
}

export function trainingModeLabel(value) {
  return TRAINING_MODE_LABELS[value] ?? "その他の練習"
}

export function capabilityLabel(value) {
  return CAPABILITY_LABELS[value] ?? "その他の力"
}

const AXIS_LABELS = {
  DIRECTION: "方向",
  TIME: "時間",
  SUBJECT: "主体",
  INTENT: "意図",
  MEANING: "意味",
  REGISTER: "丁寧さ",
}

export function axisLabel(value) {
  return (value && AXIS_LABELS[value]) || "境界"
}

export function purposeLabel(value) {
  return value === "Measure"
    ? "測る"
    : value === "Train"
      ? "練習する"
      : value === "Verify"
        ? "確かめる"
        : "取り組む"
}

export function weaknessLabel(value) {
  return value === null || value === undefined ? "" : WEAKNESS_LABELS[value] ?? "その他の課題"
}

export function categoryLabel(value) {
  return CATEGORY_LABELS[value] ?? "その他"
}

export function reasonLabel(value) {
  if (value === "insufficient_evidence") return "まだ練習記録が少ないため"
  if (value === "scheduled_measurement") return "現在の力を定期的に確認するため"
  if (value.startsWith("retention_due:")) return "覚えているか確認する時期のため"
  if (value.startsWith("verify:")) return "弱点が改善したか確かめるため"
  if (value.startsWith("diagnosis:")) {
    return `${weaknessLabel(value.slice("diagnosis:".length))}を改善するため`
  }
  return "選定理由を確認できません"
}

export function diagnosisStatusLabel(value) {
  return value === "active" ? "練習中" : value === "resolved" ? "改善済み" : "状態不明"
}

export function gradingStatusLabel(value) {
  return value === "graded"
    ? "採点済み"
    : value === "ungraded"
      ? "判定保留"
      : value === "invalid"
        ? "判定できず"
        : "状態不明"
}

export function observerLabel(value) {
  if (value.startsWith("phase1-exact-match-")) return "ルール採点"
  if (value.startsWith("phase1-rubric-ai-")) return "AI採点"
  if (value.startsWith("human-review-")) return "人による確認"
  return "採点方法不明"
}

export function aiReasonLabel(reason) {
  if (reason === "setting_off") return "設定で AI をオフにしています。"
  if (reason === "key_missing") return "API キーが未設定です。"
  if (reason === "limit_reached") return "AI の利用額が上限に達しました。"
  return "AI機能が現在利用できません。"
}

export function uiErrorMessage(value, fallback = "処理に失敗しました。もう一度お試しください。") {
  if (typeof value !== "string" || value.trim() === "") return fallback
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(value) ? value : fallback
}
