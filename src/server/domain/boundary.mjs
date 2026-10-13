// 混同ペアの目印。DB も AI も使わない。

const pair = (suffix) => `11111111-1111-4111-8111-${suffix.padStart(12, "0")}`

/** 長い目印を先に見る。短い "do you" が "do you mean" を横取りしないため。 */
const WATCHES = [
  [pair("60"), ["give me a moment"], [], ["wait a moment"], []],
  [pair("d0"), ["explain that again"], [], ["say that again"], []],
  [pair("e0"), ["more specific"], [], ["could you explain", "can you explain", "explain"], []],
  [pair("f0"), ["give me an example", "give an example"], [], ["show me"], []],
  [pair("100"), ["can i check", "could i check"], [], ["could you check", "can you check"], []],
  [pair("90"), ["what do you mean"], [], ["what does that mean"], []],
  [pair("a0"), ["you mean"], ["do you mean", "what do you mean"], ["you're saying", "you are saying"], []],
  [pair("b0"), ["are you asking"], [], ["are you saying"], []],
  [pair("c0"), ["are you referring"], [], ["are you talking"], []],
  [pair("110"), ["what happened next"], [], ["what happened"], ["what happened next"]],
  [pair("120"), ["what makes you say"], [], ["why"], []],
  [pair("130"), ["what are you doing"], [], ["what are you going to"], []],
  [pair("30"), ["did you say"], [], ["do you mean"], []],
  [pair("40"), ["do you mean"], [], ["does that mean"], []],
  [pair("50"), ["are you asking"], [], ["do you want me"], []],
  [pair("10"), ["because"], [], ["thats why"], []],
  [pair("140"), ["did you"], ["did you say"], ["were you"], []],
  [pair("20"), ["did you"], ["did you say"], ["have you ever"], []],
  [pair("70"), ["can i", "could i"], ["can i check", "could i check"], ["could you", "can you"], ["could you check", "can you check", "wait a moment", "give me a moment"]],
  [pair("150"), ["can you", "can i"], [], ["could you", "could i"], []],
  [pair("150"), ["can"], ["can you", "can i"], ["could"], ["could you", "could i"]],
  [pair("160"), ["going to"], ["what are you going to"], ["will", "i'll", "we'll", "you'll", "they'll", "it'll"], []],
  [pair("170"), ["want to"], [], ["would like"], []],
  [pair("80"), ["are you"], ["are you asking", "are you saying", "are you talking", "are you referring", "what are you"], ["do you"], ["do you mean", "do you want"]],
  [pair("180"), ["any", "anything", "anyone", "anybody", "anywhere"], [], ["some", "something", "someone", "somebody", "somewhere"], []],
  [pair("190"), ["many"], [], ["much"], []],
  [pair("1a0"), ["say", "says", "said"], ["say that again", "did you say", "are you saying", "you're saying", "you are saying", "what makes you say"], ["tell", "tells", "told"], []],
  [pair("1b0"), ["look", "looks", "looked", "looking"], [], ["see", "sees", "saw", "seen", "seeing"], []],
  [pair("1c0"), ["look", "looks", "looked", "looking"], [], ["watch", "watches", "watched", "watching"], []],
  [pair("1d0"), ["see", "sees", "saw", "seen", "seeing"], [], ["watch", "watches", "watched", "watching"], []],
  [pair("1e0"), ["hear", "hears", "heard", "hearing"], [], ["listen", "listens", "listened", "listening"], []],
  [pair("1f0"), ["job", "jobs"], [], ["work", "works", "worked", "working"], []],
  [pair("200"), ["fun"], [], ["funny"], []],
]

export function folded(input) {
  return String(input)
    .toLowerCase()
    .replaceAll("’", "'")
    .replaceAll("‘", "'")
    .replace(/[^\p{L}\p{N}']/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replaceAll("that's", "thats")
    .replaceAll("that is", "thats")
}

function hasPhrase(text, phrase) {
  return ` ${text} `.includes(` ${phrase} `)
}

function sideUsed(text, markers, blockers) {
  if (blockers.some((blocker) => hasPhrase(text, blocker))) return false
  return markers.some((marker) => hasPhrase(text, marker))
}

export function boundaryCrossed(canonical, expected, actual) {
  const target = `${folded(canonical)} ${folded(expected)}`
  const answer = folded(actual)
  for (const [pairId, markersA, blockersA, markersB, blockersB] of WATCHES) {
    const targetA = sideUsed(target, markersA, blockersA)
    const targetB = sideUsed(target, markersB, blockersB)
    const usedA = sideUsed(answer, markersA, blockersA)
    const usedB = sideUsed(answer, markersB, blockersB)
    if (targetA && !targetB && usedB && !usedA) return { pairId, missed: "a" }
    if (targetB && !targetA && usedA && !usedB) return { pairId, missed: "b" }
  }
  return null
}
