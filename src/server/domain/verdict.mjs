// 回答の結果を、画面が見出しとボタンを決めるための 1 語にする。

/** pending（採点待ち）/ success / retry（要復習）/ ungraded（確認できなかった）。 */
export function verdict(gradingStatus, outcome) {
  if (gradingStatus === "pending") return "pending"
  if (gradingStatus === "graded" && outcome === "success") return "success"
  if (gradingStatus === "graded" && outcome != null) return "retry"
  return "ungraded"
}

/** 画面に足す項目。再判定のボタンは、確認できなかった回答にだけ出す。 */
export function verdictFields(gradingStatus, outcome) {
  const value = verdict(gradingStatus, outcome)
  return { verdict: value, canRegrade: value === "ungraded" }
}

/** 選んで答える正答率が 90% 以上なのに、書いて答える正答率が 80% 未満（または未測定）。 */
export function recognizedNotRecalled({ choiceSuccess, choiceGraded, textSuccess, textGraded }) {
  if (!choiceGraded) return false
  const chooseRate = choiceSuccess / choiceGraded
  const writeWeak = !textGraded || textSuccess / textGraded < 0.8
  return chooseRate >= 0.9 && writeWeak
}
