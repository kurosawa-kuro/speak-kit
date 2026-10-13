// 数の見せ方（秒・%・回）をここにまとめる。値が無いときは「未測定」。

export const UNMEASURED = "未測定"

export function percent(rate) {
  return rate === null || rate === undefined ? UNMEASURED : `${Math.round(rate * 100)}%`
}

export function ratio(success, graded) {
  return graded ? `${success}/${graded}　${percent(success / graded)}` : UNMEASURED
}

export function seconds(ms) {
  return ms === null || ms === undefined ? UNMEASURED : `${(ms / 1000).toFixed(1)}秒`
}

export function date(value) {
  return value === null || value === undefined ? UNMEASURED : new Date(value).toLocaleDateString("ja-JP")
}

export function usd(value) {
  return `$${Number(value).toFixed(2)}`
}
