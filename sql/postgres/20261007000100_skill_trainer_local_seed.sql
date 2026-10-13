-- 英会話学習アプリ Phase 1 Core seed。idea doc本文に literal に記載されている例文・チャンクだけを
-- seedする（「既存のCore30」はowner所持の想定素材で本リポジトリに実体が無いため架空生成しない。
-- 正本 = docs/repos/frontend/retool/specs/英会話学習アプリ-適応訓練エンジン設計.md
-- 3章(reusable parts)・6章(L3例)・7.2章(Controlled Recall例)・12章(Tier1チャンク例)）。
-- Applied by `skill-trainer skill-trainer-local-schema-apply` as the admin role (DB_FLOW_URL).

INSERT INTO skill_trainer.learning_policy (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO skill_trainer.skills
    (canonical_pattern, meaning, category, intent, phase, tier, direction, output_policy)
VALUES
    ('Could you say that again?', 'もう一度言ってもらえますか？', 'ERROR_HANDLING', 'CLARIFICATION_REQUEST', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('What did you do yesterday?', '昨日何をしましたか？', 'QUERY', 'QUESTION_BACK', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Could you help me?', '手伝ってもらえますか？', 'ACTION', 'REQUEST', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Could you check this?', 'これを確認してもらえますか？', 'ACTION', 'REQUEST', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Could you explain that?', 'それを説明してもらえますか？', 'ACTION', 'REQUEST', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Did you go to Tokyo?', '東京に行きましたか？', 'QUERY', 'QUESTION_BACK', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Have you ever been to Tokyo?', '東京に行ったことがありますか？', 'QUERY', 'QUESTION_BACK', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('get home', '帰宅する', 'ACTION', 'CHUNK', 1, 'TIER1', 'OUTPUT', NULL),
    ('get tired', '疲れる', 'ACTION', 'CHUNK', 1, 'TIER1', 'OUTPUT', NULL),
    ('get ready', '準備する', 'ACTION', 'CHUNK', 1, 'TIER1', 'OUTPUT', NULL),
    ('take a break', '休憩する', 'ACTION', 'CHUNK', 1, 'TIER1', 'OUTPUT', NULL),
    ('have breakfast', '朝食を食べる', 'ACTION', 'CHUNK', 1, 'TIER1', 'OUTPUT', NULL)
ON CONFLICT (canonical_pattern) DO NOTHING;
