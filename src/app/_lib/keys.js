/** 日本語入力の変換を確定するための Enter か。Safari は確定の Enter で isComposing が false になり、keyCode 229 を出す。 */
export function isImeEnter(event) {
  return event.key === "Enter" && (event.nativeEvent?.isComposing === true || event.keyCode === 229)
}

/** 変換の確定ではない、送信のための Enter か。 */
export function isSubmitEnter(event) {
  return event.key === "Enter" && !isImeEnter(event)
}
