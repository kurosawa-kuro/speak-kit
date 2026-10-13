-- 英会話学習アプリ Phase 1 Core seed（本編）。owner所持の実素材
-- docs/tasks/02_backlog/phase1_english_japanese_seed.json（Core30 = OUTPUT/QUERY/TIME/ACTION/
-- ERROR_HANDLING各骨格＋生活部品Tier1のget/take/have/go/feelチャンク、計50件）を正本として
-- 投入する。20261007000100の12件は「本材料が無いため架空生成しない」旧暫定seedで、本migration
-- が本編。
--
-- フィールド名の正規化（JSON → schema。値の意味は変えない）:
--   tier "TIER_1" → 'TIER1'（schemaのCHECK制約はアンダースコア無し）
--   category "CHUNK" → 'ACTION'（schemaのcategory CHECKにCHUNKは無い。既存12件seedの
--     Tier1チャンクも同じくcategory='ACTION'・intentでCHUNK性を表している前例に揃える）
--   JSONのintent（DAILY_LIFE/STATE_CHANGE等）はそのまま採用（intentはCHECK制約なし・
--     旧seedの汎用的な intent='CHUNK' より表現力が高い）
--
-- canonical_pattern UNIQUE制約により、既存12件seedと重複する5件（get home/get tired/
-- get ready/take a break/have breakfast）はON CONFLICT DO NOTHINGで無視される
-- （既存行のmeaning・template_group等のタグ付けは保持される。例えば have breakfast の
-- meaningは旧seedの「朝食を食べる」が残り、本ファイルの「朝食をとる」は採用されない）。
--
-- Do/Did/Are/What/Why/How/Could/Would等の「...」を含む行はidea doc 3章の意味での型
-- （reusable parts）そのもので、具体的な一文ではない。Controlled RecallのAI採点は
-- 完全一致を要求せず意味一致で判定するため型のまま投入するが、実運用で学習者が
-- 「何を埋めるべきか分からず詰まる」場合は、具体例文への差し替えまたは別の出題方式への
-- 変更を検討する（管理｜英会話学習.md「実装状況」に経過を記録する）。
--
-- Applied by `skill-trainer skill-trainer-local-schema-apply` as the admin role (DB_FLOW_URL).

INSERT INTO skill_trainer.skills
    (canonical_pattern, meaning, category, intent, phase, tier, direction, output_policy)
VALUES
    ('I''m ...', '私は〜です。', 'OUTPUT', 'SELF_DESCRIPTION', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('I like ...', '〜が好きです。', 'OUTPUT', 'PREFERENCE', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('I want to ...', '〜したいです。', 'OUTPUT', 'DESIRE', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('I ... because ...', '〜です。なぜなら…だからです。', 'OUTPUT', 'REASON', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('It took me a long time to ...', '〜するまで長い時間がかかった。', 'OUTPUT', 'HISTORY', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('That''s why I ...', 'だから僕は〜なんだ。', 'OUTPUT', 'CONCLUSION_REASON', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('In my case, ...', '僕の場合は〜。', 'OUTPUT', 'PERSONAL_CASE', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('I had no choice but to ...', '〜するしかなかった。', 'OUTPUT', 'NO_CHOICE', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('I used to ..., but now ...', '昔は〜だった。でも今は〜。', 'OUTPUT', 'PAST_VS_NOW', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('I don''t mean A. I mean B.', 'Aという意味じゃない。Bという意味。', 'OUTPUT', 'CORRECTION', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Do you ...?', '〜する？', 'QUERY', 'PRESENT_YES_NO', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Did you ...?', '〜した？', 'QUERY', 'PAST_YES_NO', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Are you ...?', '〜なの？', 'QUERY', 'STATE_YES_NO', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('What ...?', '何〜？', 'QUERY', 'DETAIL_WHAT', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Why ...?', 'なぜ〜？', 'QUERY', 'REASON_WHY', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('How ...?', 'どう〜？', 'QUERY', 'STATE_HOW', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Have you ever ...?', '〜したことある？', 'QUERY', 'EXPERIENCE', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('How about you?', 'あなたは？', 'QUERY', 'QUESTION_BACK', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('I usually ...', '普段は〜。', 'TIME', 'USUAL', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('I ... yesterday.', '昨日〜した。', 'TIME', 'PAST', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('I''m ...ing now.', '今〜している。', 'TIME', 'NOW', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('I''m going to ...', '〜する予定。', 'TIME', 'FUTURE', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('I''ve been to ...', '〜に行ったことがある。', 'TIME', 'EXPERIENCE', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Could I ...?', '〜してもいいですか？', 'ACTION', 'PERMISSION', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Could you ...?', '〜してもらえますか？', 'ACTION', 'REQUEST', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Would you like to ...?', '〜しませんか？', 'ACTION', 'INVITATION', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('How about ...?', '〜はどう？', 'ACTION', 'SUGGESTION', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Could you say that again?', 'もう一度言ってもらえますか？', 'ERROR_HANDLING', 'REPEAT_REQUEST', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('What does that mean?', 'それはどういう意味？', 'ERROR_HANDLING', 'MEANING_CHECK', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('Do you mean ...?', 'つまり〜という意味？', 'ERROR_HANDLING', 'CONFIRMATION', 1, 'CORE', 'OUTPUT', 'POLITE_NEUTRAL'),
    ('get home', '家に着く', 'ACTION', 'DAILY_LIFE', 1, 'TIER1', 'OUTPUT', NULL),
    ('get tired', '疲れる', 'ACTION', 'STATE_CHANGE', 1, 'TIER1', 'OUTPUT', NULL),
    ('get better', '良くなる', 'ACTION', 'STATE_CHANGE', 1, 'TIER1', 'OUTPUT', NULL),
    ('get ready', '準備する', 'ACTION', 'DAILY_LIFE', 1, 'TIER1', 'OUTPUT', NULL),
    ('take a shower', 'シャワーを浴びる', 'ACTION', 'DAILY_LIFE', 1, 'TIER1', 'OUTPUT', NULL),
    ('take a break', '休憩する', 'ACTION', 'DAILY_LIFE', 1, 'TIER1', 'OUTPUT', NULL),
    ('take a bus', 'バスに乗る', 'ACTION', 'TRANSPORT', 1, 'TIER1', 'OUTPUT', NULL),
    ('take medicine', '薬を飲む', 'ACTION', 'DAILY_LIFE', 1, 'TIER1', 'OUTPUT', NULL),
    ('have breakfast', '朝食をとる', 'ACTION', 'DAILY_LIFE', 1, 'TIER1', 'OUTPUT', NULL),
    ('have time', '時間がある', 'ACTION', 'AVAILABILITY', 1, 'TIER1', 'OUTPUT', NULL),
    ('have fun', '楽しむ', 'ACTION', 'ENJOYMENT', 1, 'TIER1', 'OUTPUT', NULL),
    ('have a problem', '問題がある', 'ACTION', 'PROBLEM', 1, 'TIER1', 'OUTPUT', NULL),
    ('go home', '帰る', 'ACTION', 'DAILY_LIFE', 1, 'TIER1', 'OUTPUT', NULL),
    ('go shopping', '買い物に行く', 'ACTION', 'DAILY_LIFE', 1, 'TIER1', 'OUTPUT', NULL),
    ('go out', '出かける', 'ACTION', 'DAILY_LIFE', 1, 'TIER1', 'OUTPUT', NULL),
    ('go wrong', 'うまくいかない', 'ACTION', 'PROBLEM', 1, 'TIER1', 'OUTPUT', NULL),
    ('feel tired', '疲れを感じる', 'ACTION', 'FEELING', 1, 'TIER1', 'OUTPUT', NULL),
    ('feel better', '気分・体調が良くなる', 'ACTION', 'FEELING', 1, 'TIER1', 'OUTPUT', NULL),
    ('feel good', '気分がいい', 'ACTION', 'FEELING', 1, 'TIER1', 'OUTPUT', NULL),
    ('feel like ...', '〜したい気分', 'ACTION', 'DESIRE', 1, 'TIER1', 'OUTPUT', NULL)
ON CONFLICT (canonical_pattern) DO NOTHING;
