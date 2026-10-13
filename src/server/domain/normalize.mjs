const CONTRACTIONS = {
  "i'm": "i am",
  "what's": "what is",
  "that's": "that is",
  "it's": "it is",
  "let's": "let us",
  "you're": "you are",
  "we're": "we are",
  "they're": "they are",
  "don't": "do not",
  "can't": "cannot",
  "couldn't": "could not",
  "wouldn't": "would not",
  "isn't": "is not",
  "aren't": "are not",
  "didn't": "did not",
  "doesn't": "does not",
  "wasn't": "was not",
  "weren't": "were not",
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

/** 回答を比べるための正規化。大文字小文字、末尾の句読点、短縮形の違いをそろえる。 */
export function normalizeAnswer(input) {
  const lowered = text(input).toLowerCase().replaceAll("’", "'")
  const stripped = lowered.replace(/[?.!,]+$/u, "").replaceAll(/[,;:]/g, " ")
  return stripped
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => CONTRACTIONS[token] || token)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
}

/** 型の {slot} を「...」にして学習者に見せる形にする。 */
export function learnerPhrase(canonical) {
  let phrase = ""
  let rest = canonical || ""
  while (rest.includes("{")) {
    const start = rest.indexOf("{")
    phrase += rest.slice(0, start)
    rest = rest.slice(start + 1)
    const end = rest.indexOf("}")
    if (end >= 0) {
      phrase += "..."
      rest = rest.slice(end + 1)
    } else {
      phrase += "{"
      break
    }
  }
  return phrase + rest
}
