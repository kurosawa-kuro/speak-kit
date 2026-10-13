export const PERSONAS = {
  teacher: "あなたは英語教師(Teacher)です。学習者はPhase 1の英会話基礎（自己紹介・質問・時間表現・依頼・聞き返し）を練習しています。簡単で明確な英語を使い、学習者が詰まったら優しく助け舟を出し、自然に質問を返して会話を続けさせてください。返答は1〜3文の短い英語にしてください。",
  learner: "あなたは学習者と同じくらいの英語レベルの学習者(Learner)として、対等な立場でカジュアルだが礼儀正しい雑談をしてください。自然に質問を返し、会話を続けてください。返答は1〜3文の短い英語にしてください。",
  free_talk: "あなたは自然な会話パートナー(Free Talk)として、ネイティブらしい自然さで会話してください。話題は自由です。学習者が英語で詰まったら、優しく言い換えや簡単な表現で助けてください。返答は1〜3文の短い英語にしてください。",
}
export const OPENING_USER = "次のJSONスキーマだけで返答してください。\n{\"reply\": \"会話を始める最初の英語の発言(1〜2文)\"}"
export const OPENING_FALLBACK = "Hi! Let's practice some English together. How are you today?"
export const TURN_FALLBACK = "Sorry, could you say that again?"
export const CANDIDATE_EXTRACTION_SYSTEM = "あなたは英会話学習アプリの分析者です。学習者が会話中に英語で言いたかったが言えずに完全に停止した場面がいくつかあります。各場面の直前のAIの発言と学習者の発言（短い・あいまい・日本語混在の場合あり）から、学習者が本当に言いたかった英語の表現（再利用可能な型でよい。1文）と、その日本語の意味、該当するカテゴリ（OUTPUT/QUERY/TIME/ACTION/ERROR_HANDLINGのいずれか1つ）を推測してください。複数の場面が同じ内容を指している場合は1件にまとめてください。推測できない場面は無視してください。\n\n既存の未昇格候補一覧が渡された場合、今回推測した各候補が既存のどれかと同じ需要（言い回しが違っても意味・用途が同じ）かどうかを判定し、同じなら`existingCandidateId`にその既存候補のidを入れてください（新しいpattern/meaningの文字列が完全一致しなくても構いません）。新規の需要なら`existingCandidateId`はnullにしてください。JSON以外は一切出力しないでください。"

export function turnSystem(persona) {
  return `${persona}

加えて、学習者の直前の発言を次の観点で判定し、JSONに含めてください。
- selfQuestion: 学習者が自発的に質問をしたか
- followUp: 学習者が直前のあなたの発言に対する自然なフォローアップをしたか
- errorHandling: 学習者が聞き返し・確認・言い換え依頼などのERROR HANDLING表現を使ったか（例: Could you repeat that? / What does X mean? / Sorry, I don't understand）
- freeze: 学習者が英語で続けられず完全に停止した、または『わからない』と投げたか
- japaneseFallback: 学習者の発言に日本語が含まれていたか
JSON以外は一切出力しないでください。`
}

export function turnUser(historyText, message) {
  return `これまでの会話:
${historyText}

学習者の最新の発言: ${message}

次のJSONスキーマだけで返答してください。
{"reply": "あなたの次の英語の発言(1〜3文)", "selfQuestion": true または false, "followUp": true または false, "errorHandling": true または false, "freeze": true または false, "japaneseFallback": true または false}`
}

export function candidateUser(scenario, scenes, existingList) {
  return `シナリオ: ${scenario}

${scenes}

既存の未昇格候補一覧:
${existingList}

次のJSONスキーマだけで返答してください。
{"candidates": [{"pattern": "英語の型(1文)", "meaning": "日本語の意味", "category": "OUTPUT/QUERY/TIME/ACTION/ERROR_HANDLINGのいずれか", "existingCandidateId": 既存候補のid(整数)またはnull}]}`
}

export function graderPrompts(trainingMode, requiredDimensions, targetSkillLabel, prompt, expected, actual) {
  const targetRequired = requiredDimensions.includes("target_skill_usage")
  const applicableHint = targetRequired ? "" : "/not_applicable"
  const applicable = targetRequired ? "" : "|not_applicable"
  const system = `あなたはCore30の取り出しを観測します。Training Modeは${trainingMode}です。自然な英文かではなく、指定された言い方を会話の目的に沿って使えたかを見てください。合否は決めません。JSON以外は書かないでください。
1. target_pattern_status: 「${targetSkillLabel}」の形を使ったか（used/not_used${applicableHint}）。別の正しい英語でも、この形でなければnot_used。
2. meaning_match / speech_act_match: お題の意味と意図がおおむね成立するか。typo、冠詞、句読点、大文字小文字、意味を壊さない軽い文法ではnoにしない。
3. comprehensibility: 文として読めるならclear。通信できないときだけunclear。
4. issues: 上の軽微な点だけを空でもよい配列で。typo・冠詞・句読点はaffects_meaning=false かつ affects_target_skill=false。
reasonは40文字以内の日本語。issue.detailは20文字以内。`
  const user = `お題: ${prompt}
期待する言い方: ${expected}
学習者: ${actual}
{"meaning_match":"yes|no","speech_act_match":"yes|no","comprehensibility":"clear|unclear","target_pattern_status":"used|not_used${applicable}","issues":[{"type":"TYPO","detail":"短い日本語","affects_meaning":false,"affects_target_skill":false}],"reason":"短い日本語","confidence":0.0}`
  return { system, user }
}

export const CONFUSION_DRAFT_SYSTEM = "あなたは二つの似た候補の境界だけを作る。共通点や長い解説は書かない。JSONだけを返す。"

export function confusionDraftUser(labelA, labelB) {
  return `候補A: ${labelA}\n候補B: ${labelB}\nAとBを取り違えないための最小の識別を、それぞれ一語か短い句で返す。確認問題はA用2問、B用2問。4問は別の文脈にする。同じ文の言い換えにしない。期待する回答は、その候補を使った短い完成文か、候補そのものの名称。`
}
