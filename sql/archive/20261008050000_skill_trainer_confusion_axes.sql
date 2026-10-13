-- 混同の型と、視点・主体・時間・方向が1軸だけ違う Core30 の監視8対。
-- 未誤答の対は next_due_at を NULL のままにし、点数を出さない。

ALTER TABLE skill_trainer.confusion_pairs
  ADD COLUMN IF NOT EXISTS confusion_type VARCHAR(20) NOT NULL DEFAULT 'MEANING';

ALTER TABLE skill_trainer.confusion_pairs
  DROP CONSTRAINT IF EXISTS confusion_pairs_type_chk;

ALTER TABLE skill_trainer.confusion_pairs
  ADD CONSTRAINT confusion_pairs_type_chk
  CHECK (confusion_type IN ('DIRECTION', 'TIME', 'SUBJECT', 'INTENT', 'MEANING', 'REGISTER'));

UPDATE skill_trainer.confusion_pairs
SET confusion_type = 'DIRECTION',
    key_a = '理由を後ろに足す',
    direction_a = '結果のあと',
    key_b = '結果を後ろに出す',
    direction_b = '理由のあと'
WHERE pair_id = '11111111-1111-4111-8111-000000000010';

INSERT INTO skill_trainer.confusion_pairs (
    pair_id, learner_key, label_a, label_b, skill_key_a, skill_key_b,
    key_a, direction_a, key_b, direction_b, source, confusion_type
) VALUES
(
    '11111111-1111-4111-8111-000000000020', 'default',
    'Did you ...?', 'Have you ever ...?',
    'QUESTION_PAST_DID', 'QUESTION_EXPERIENCE_HAVE_EVER',
    'その時した？', '特定の過去', '経験ある？', '経験の有無',
    'catalog', 'TIME'
),
(
    '11111111-1111-4111-8111-000000000030', 'default',
    'Did you say ...?', 'Do you mean ...?',
    NULL, 'MEANING_CONFIRMATION',
    '発言の確認', '言った言葉', '意味の確認', '意図した内容',
    'catalog', 'MEANING'
),
(
    '11111111-1111-4111-8111-000000000040', 'default',
    'Do you mean ...?', 'Does that mean ...?',
    'MEANING_CONFIRMATION', NULL,
    'あなたの意図', '人', 'そこから導かれる意味', '内容',
    'catalog', 'INTENT'
),
(
    '11111111-1111-4111-8111-000000000050', 'default',
    'Are you asking me to ...?', 'Do you want me to ...?',
    NULL, NULL,
    '今の発言は依頼？', '発言の意図', 'してほしい？', '希望',
    'catalog', 'INTENT'
),
(
    '11111111-1111-4111-8111-000000000060', 'default',
    'Could you give me a moment?', 'Could you wait a moment?',
    NULL, NULL,
    '私が時間をもらう', '自分', 'あなたが待つ', '相手',
    'catalog', 'SUBJECT'
),
(
    '11111111-1111-4111-8111-000000000070', 'default',
    'Can I ...?', 'Could you ...?',
    'PERMISSION_COULD_I', 'REQUEST_COULD_YOU',
    '私がしていい？', '自分', 'あなたにしてほしい', '相手',
    'catalog', 'SUBJECT'
),
(
    '11111111-1111-4111-8111-000000000080', 'default',
    'Are you ...ing?', 'Do you ...?',
    NULL, 'QUESTION_PRESENT_DO',
    '今', '進行', '普段', '習慣',
    'catalog', 'TIME'
)
ON CONFLICT (pair_id) DO NOTHING;

INSERT INTO skill_trainer.confusion_probes (probe_id, pair_id, side, ordinal, prompt, expected_text) VALUES
  ('11111111-1111-4111-8111-000000000021', '11111111-1111-4111-8111-000000000020', 'a', 1,
   '昨日、東京に行きましたか。', 'Did you go to Tokyo yesterday?'),
  ('11111111-1111-4111-8111-000000000022', '11111111-1111-4111-8111-000000000020', 'b', 1,
   '東京に行ったことはありますか。', 'Have you ever been to Tokyo?'),
  ('11111111-1111-4111-8111-000000000023', '11111111-1111-4111-8111-000000000020', 'a', 2,
   '今朝、コーヒーを飲みましたか。', 'Did you drink coffee this morning?'),
  ('11111111-1111-4111-8111-000000000024', '11111111-1111-4111-8111-000000000020', 'b', 2,
   '寿司を食べたことはありますか。', 'Have you ever eaten sushi?'),

  ('11111111-1111-4111-8111-000000000031', '11111111-1111-4111-8111-000000000030', 'a', 1,
   '今、「明日」と言いましたか。', 'Did you say tomorrow?'),
  ('11111111-1111-4111-8111-000000000032', '11111111-1111-4111-8111-000000000030', 'b', 1,
   '明日という意味ですか。', 'Do you mean tomorrow?'),
  ('11111111-1111-4111-8111-000000000033', '11111111-1111-4111-8111-000000000030', 'a', 2,
   '今、「3時」と言いましたか。', 'Did you say three o''clock?'),
  ('11111111-1111-4111-8111-000000000034', '11111111-1111-4111-8111-000000000030', 'b', 2,
   '3時という意味ですか。', 'Do you mean three o''clock?'),

  ('11111111-1111-4111-8111-000000000041', '11111111-1111-4111-8111-000000000040', 'a', 1,
   '行きたくない、ということですか。', 'Do you mean you don''t want to go?'),
  ('11111111-1111-4111-8111-000000000042', '11111111-1111-4111-8111-000000000040', 'b', 1,
   'それは、行かなくていいということですか。', 'Does that mean I don''t have to go?'),
  ('11111111-1111-4111-8111-000000000043', '11111111-1111-4111-8111-000000000040', 'a', 2,
   '忙しい、ということですか。', 'Do you mean you are busy?'),
  ('11111111-1111-4111-8111-000000000044', '11111111-1111-4111-8111-000000000040', 'b', 2,
   'それは、今日は無理ということですか。', 'Does that mean today is impossible?'),

  ('11111111-1111-4111-8111-000000000051', '11111111-1111-4111-8111-000000000050', 'a', 1,
   '今の発言は、資料を送ってほしい依頼ですか。', 'Are you asking me to send the file?'),
  ('11111111-1111-4111-8111-000000000052', '11111111-1111-4111-8111-000000000050', 'b', 1,
   '資料を送ってほしいですか。', 'Do you want me to send the file?'),
  ('11111111-1111-4111-8111-000000000053', '11111111-1111-4111-8111-000000000050', 'a', 2,
   '今の発言は、ここに残ってほしい依頼ですか。', 'Are you asking me to stay here?'),
  ('11111111-1111-4111-8111-000000000054', '11111111-1111-4111-8111-000000000050', 'b', 2,
   'ここに残ってほしいですか。', 'Do you want me to stay here?'),

  ('11111111-1111-4111-8111-000000000061', '11111111-1111-4111-8111-000000000060', 'a', 1,
   '少し時間をもらえますか。', 'Could you give me a moment?'),
  ('11111111-1111-4111-8111-000000000062', '11111111-1111-4111-8111-000000000060', 'b', 1,
   '少し待ってもらえますか。', 'Could you wait a moment?'),
  ('11111111-1111-4111-8111-000000000063', '11111111-1111-4111-8111-000000000060', 'a', 2,
   '考える時間がほしいです。', 'Could you give me a moment to think?'),
  ('11111111-1111-4111-8111-000000000064', '11111111-1111-4111-8111-000000000060', 'b', 2,
   'ここで待っていてもらえますか。', 'Could you wait a moment here?'),

  ('11111111-1111-4111-8111-000000000071', '11111111-1111-4111-8111-000000000070', 'a', 1,
   '窓を開けてもいいですか。', 'Can I open the window?'),
  ('11111111-1111-4111-8111-000000000072', '11111111-1111-4111-8111-000000000070', 'b', 1,
   '窓を開けてもらえますか。', 'Could you open the window?'),
  ('11111111-1111-4111-8111-000000000073', '11111111-1111-4111-8111-000000000070', 'a', 2,
   'これを確認してもいいですか。', 'Could I check this?'),
  ('11111111-1111-4111-8111-000000000074', '11111111-1111-4111-8111-000000000070', 'b', 2,
   'これを確認してもらえますか。', 'Could you check this?'),

  ('11111111-1111-4111-8111-000000000081', '11111111-1111-4111-8111-000000000080', 'a', 1,
   '今、コーヒーを飲んでいますか。', 'Are you drinking coffee now?'),
  ('11111111-1111-4111-8111-000000000082', '11111111-1111-4111-8111-000000000080', 'b', 1,
   '普段、コーヒーを飲みますか。', 'Do you drink coffee?'),
  ('11111111-1111-4111-8111-000000000083', '11111111-1111-4111-8111-000000000080', 'a', 2,
   '今、英語を勉強していますか。', 'Are you studying English now?'),
  ('11111111-1111-4111-8111-000000000084', '11111111-1111-4111-8111-000000000080', 'b', 2,
   '普段、英語を勉強しますか。', 'Do you study English?')
ON CONFLICT (probe_id) DO NOTHING;
