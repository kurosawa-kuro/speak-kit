//! 英会話ドメインのプロンプトと固定応答。適応エンジンはここを直接参照しない。

pub const CATEGORY_CODES: [&str; 5] = ["OUTPUT", "QUERY", "TIME", "ACTION", "ERROR_HANDLING"];

const TEACHER_PERSONA: &str =
    "あなたは英語教師(Teacher)です。学習者はPhase 1の英会話基礎（自己紹介・質問・時間表現・\
             依頼・聞き返し）を練習しています。簡単で明確な英語を使い、学習者が詰まったら優しく\
             助け舟を出し、自然に質問を返して会話を続けさせてください。返答は1〜3文の短い英語に\
             してください。";

const LEARNER_PERSONA: &str =
    "あなたは学習者と同じくらいの英語レベルの学習者(Learner)として、対等な立場でカジュアル\
             だが礼儀正しい雑談をしてください。自然に質問を返し、会話を続けてください。返答は\
             1〜3文の短い英語にしてください。";

const FREE_TALK_PERSONA: &str =
    "あなたは自然な会話パートナー(Free Talk)として、ネイティブらしい自然さで会話して\
             ください。話題は自由です。学習者が英語で詰まったら、優しく言い換えや簡単な表現で\
             助けてください。返答は1〜3文の短い英語にしてください。";

pub const TALK_OPENING_USER: &str = "次のJSONスキーマだけで返答してください。\n\
         {\"reply\": \"会話を始める最初の英語の発言(1〜2文)\"}";

pub const TALK_OPENING_FALLBACK: &str =
    "Hi! Let's practice some English together. How are you today?";

pub const TALK_TURN_FALLBACK: &str = "Sorry, could you say that again?";

pub const CANDIDATE_EXTRACTION_SYSTEM: &str =
    "あなたは英会話学習アプリの分析者です。学習者が会話中に英語で言いたかった\
        が言えずに完全に停止した場面がいくつかあります。各場面の直前のAIの発言と学習者の発言\
        （短い・あいまい・日本語混在の場合あり）から、学習者が本当に言いたかった英語の表現\
        （再利用可能な型でよい。1文）と、その日本語の意味、該当するカテゴリ\
        （OUTPUT/QUERY/TIME/ACTION/ERROR_HANDLINGのいずれか1つ）を推測してください。複数の\
        場面が同じ内容を指している場合は1件にまとめてください。推測できない場面は無視して\
        ください。\n\n既存の未昇格候補一覧が渡された場合、今回推測した各候補が既存のどれかと\
        同じ需要（言い回しが違っても意味・用途が同じ）かどうかを判定し、同じなら\
        `existingCandidateId`にその既存候補のidを入れてください（新しいpattern/meaningの\
        文字列が完全一致しなくても構いません）。新規の需要なら`existingCandidateId`は\
        nullにしてください。JSON以外は一切出力しないでください。";

pub fn talk_scenario_supported(scenario: &str) -> bool {
    matches!(scenario, "teacher" | "learner" | "free_talk")
}

pub fn talk_persona(scenario: &str) -> Option<&'static str> {
    Some(match scenario {
        "teacher" => TEACHER_PERSONA,
        "learner" => LEARNER_PERSONA,
        "free_talk" => FREE_TALK_PERSONA,
        _ => return None,
    })
}

pub fn talk_opening_system(persona: &str) -> String {
    format!("{persona}\nこれは会話の最初のターンです。自然な一言で会話を始めてください。")
}

pub fn talk_turn_system(persona: &str) -> String {
    format!(
        "{persona}\n\n加えて、学習者の直前の発言を次の観点で判定し、JSONに含めてください。\n\
         - selfQuestion: 学習者が自発的に質問をしたか\n\
         - followUp: 学習者が直前のあなたの発言に対する自然なフォローアップをしたか\n\
         - errorHandling: 学習者が聞き返し・確認・言い換え依頼などのERROR HANDLING表現を\
         使ったか（例: Could you repeat that? / What does X mean? / Sorry, I don't understand）\n\
         - freeze: 学習者が英語で続けられず完全に停止した、または『わからない』と投げたか\n\
         - japaneseFallback: 学習者の発言に日本語が含まれていたか\n\
         JSON以外は一切出力しないでください。"
    )
}

pub fn talk_turn_user(history_text: &str, user_message: &str) -> String {
    format!(
        "これまでの会話:\n{history_text}\n\n学習者の最新の発言: {user_message}\n\n\
         次のJSONスキーマだけで返答してください。\n\
         {{\"reply\": \"あなたの次の英語の発言(1〜3文)\", \"selfQuestion\": true または false, \
         \"followUp\": true または false, \"errorHandling\": true または false, \
         \"freeze\": true または false, \"japaneseFallback\": true または false}}"
    )
}

pub fn candidate_extraction_user(scenario: &str, scenes: &str, existing_list: &str) -> String {
    format!(
        "シナリオ: {scenario}\n\n{scenes}\n\n既存の未昇格候補一覧:\n{existing_list}\n\n\
         次のJSONスキーマだけで返答してください。\n\
         {{\"candidates\": [{{\"pattern\": \"英語の型(1文)\", \"meaning\": \"日本語の意味\", \
         \"category\": \"OUTPUT/QUERY/TIME/ACTION/ERROR_HANDLINGのいずれか\", \
         \"existingCandidateId\": 既存候補のid(整数)またはnull}}]}}"
    )
}

pub fn grader_prompts(
    training_mode: &str,
    required_dimensions: &[String],
    target_skill_label: &str,
    prompt: &str,
    expected: &str,
    actual: &str,
) -> (String, String) {
    let target_required = required_dimensions
        .iter()
        .any(|name| name == "target_skill_usage");
    let applicable_hint = if target_required {
        ""
    } else {
        "/not_applicable"
    };
    let applicable = if target_required {
        ""
    } else {
        "|not_applicable"
    };
    let system_prompt = format!(
        "あなたはCore30の取り出しを観測します。Training Modeは{training_mode}です。\
         自然な英文かではなく、指定された言い方を会話の目的に沿って使えたかを見てください。\
         合否は決めません。JSON以外は書かないでください。\n\
         1. target_pattern_status: 「{target_skill_label}」の形を使ったか\
         （used/not_used{applicable_hint}）。別の正しい英語でも、この形でなければnot_used。\n\
         2. meaning_match / speech_act_match: お題の意味と意図がおおむね成立するか。\
         typo、冠詞、句読点、大文字小文字、意味を壊さない軽い文法ではnoにしない。\n\
         3. comprehensibility: 文として読めるならclear。通信できないときだけunclear。\n\
         4. issues: 上の軽微な点だけを空でもよい配列で。typo・冠詞・句読点は\
         affects_meaning=false かつ affects_target_skill=false。\n\
         reasonは40文字以内の日本語。issue.detailは20文字以内。"
    );
    let user_prompt = format!(
        "お題: {prompt}\n期待する言い方: {expected}\n学習者: {actual}\n\
         {{\"meaning_match\":\"yes|no\",\"speech_act_match\":\"yes|no\",\
         \"comprehensibility\":\"clear|unclear\",\
         \"target_pattern_status\":\"used|not_used{applicable}\",\
         \"issues\":[{{\"type\":\"TYPO\",\"detail\":\"短い日本語\",\"affects_meaning\":false,\"affects_target_skill\":false}}],\
         \"reason\":\"短い日本語\",\"confidence\":0.0}}"
    );
    (system_prompt, user_prompt)
}

pub fn learner_feedback(
    outcome_label: &str,
    cause: Option<&str>,
    canonical: &str,
    meaning: &str,
    actual: &str,
) -> String {
    let phrase = learner_phrase(canonical);
    let gloss = meaning.trim();
    let named = if gloss.is_empty() {
        format!("「{phrase}」")
    } else {
        format!("「{phrase}」（{gloss}）")
    };
    match outcome_label {
        "pass" => format!("意味も、今回の言い方{named}も合っています。"),
        "pass_with_note" => format!(
            "意味は伝わっていて、今回の言い方{named}も使えています。細かい揺れは次で直せば十分です。"
        ),
        "retry_target" => {
            let actual = actual.trim();
            if actual.is_empty() {
                format!("意味は伝わっています。今回は{named}を使う練習です。まずこの形を使ってみましょう。")
            } else {
                format!(
                    "意味は伝わっています。今回は{named}を使う練習です。「{actual}」ではなく、まずこの形を使ってみましょう。"
                )
            }
        }
        "retry_form" => format!(
            "意味は伝わっています。今回の言い方は{named}です。この形の一部が足りないので、回答例と同じ形でもう一度書いてみましょう。"
        ),
        "fail_communication" if cause == Some("INTENT") => format!(
            "文としては読めますが、今回の場面の言い方になっていません。今回は{named}を使う練習です。"
        ),
        _ => format!(
            "まだ意味が相手に届いていません。今回は{named}を使う練習です。回答例の形をそのまま使ってみましょう。"
        ),
    }
}

fn learner_phrase(canonical: &str) -> String {
    let mut phrase = String::new();
    let mut rest = canonical;
    while let Some(start) = rest.find('{') {
        phrase.push_str(&rest[..start]);
        rest = &rest[start + 1..];
        if let Some(end) = rest.find('}') {
            phrase.push_str("...");
            rest = &rest[end + 1..];
        } else {
            phrase.push('{');
            break;
        }
    }
    phrase.push_str(rest);
    phrase
}
