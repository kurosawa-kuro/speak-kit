-- クイッククイズの段階。意味を選ぶ・用途から選ぶ・文を選ぶを、50表現それぞれに作る。

ALTER TABLE skill_trainer.quiz_items ALTER COLUMN probe_id DROP NOT NULL;
ALTER TABLE skill_trainer.quiz_items ALTER COLUMN pair_id DROP NOT NULL;
ALTER TABLE skill_trainer.quiz_items
  ADD COLUMN IF NOT EXISTS quiz_type VARCHAR(20) NOT NULL DEFAULT 'contrast',
  ADD COLUMN IF NOT EXISTS skill_id BIGINT REFERENCES skill_trainer.skill_concepts(id);
ALTER TABLE skill_trainer.quiz_items DROP CONSTRAINT IF EXISTS quiz_items_capability_check;
ALTER TABLE skill_trainer.quiz_items DROP CONSTRAINT IF EXISTS quiz_items_quiz_type_check;
ALTER TABLE skill_trainer.quiz_items DROP CONSTRAINT IF EXISTS quiz_items_target_check;
ALTER TABLE skill_trainer.quiz_items
  ADD CONSTRAINT quiz_items_capability_check CHECK (capability IN ('CONTRAST_SELECTION', 'RECOGNITION')),
  ADD CONSTRAINT quiz_items_quiz_type_check CHECK (quiz_type IN ('contrast', 'meaning', 'intent', 'form')),
  ADD CONSTRAINT quiz_items_target_check CHECK (pair_id IS NOT NULL OR skill_id IS NOT NULL);

ALTER TABLE skill_trainer.quiz_attempts ALTER COLUMN pair_id DROP NOT NULL;
ALTER TABLE skill_trainer.quiz_attempts
  ADD COLUMN IF NOT EXISTS quiz_type VARCHAR(20) NOT NULL DEFAULT 'contrast',
  ADD COLUMN IF NOT EXISTS skill_id BIGINT REFERENCES skill_trainer.skill_concepts(id);
ALTER TABLE skill_trainer.quiz_attempts DROP CONSTRAINT IF EXISTS quiz_attempts_capability_check;
ALTER TABLE skill_trainer.quiz_attempts
  ADD CONSTRAINT quiz_attempts_capability_check CHECK (capability IN ('CONTRAST_SELECTION', 'RECOGNITION'));
CREATE INDEX IF NOT EXISTS quiz_attempts_skill_idx
  ON skill_trainer.quiz_attempts (skill_id, answered_at DESC);

ALTER TABLE skill_trainer.quiz_promotions ALTER COLUMN pair_id DROP NOT NULL;
ALTER TABLE skill_trainer.quiz_promotions
  ADD COLUMN IF NOT EXISTS skill_id BIGINT REFERENCES skill_trainer.skill_concepts(id);
ALTER TABLE skill_trainer.quiz_promotions DROP CONSTRAINT IF EXISTS quiz_promotions_target_check;
ALTER TABLE skill_trainer.quiz_promotions
  ADD CONSTRAINT quiz_promotions_target_check CHECK (pair_id IS NOT NULL OR skill_id IS NOT NULL);

INSERT INTO skill_trainer.quiz_items
  (item_key, option_set_version, skill_id, quiz_type, capability, prompt, options, correct_option_id)
SELECT
  'QZ-' || upper(left(d.quiz_type, 2)) || '-' || sc.stable_key,
  1,
  sc.id,
  d.quiz_type,
  CASE WHEN d.quiz_type = 'meaning' THEN 'RECOGNITION' ELSE 'CONTRAST_SELECTION' END,
  CASE WHEN d.quiz_type = 'intent' THEN '「' || sc.meaning || '」とき、使う形はどれ？' ELSE d.prompt END,
  jsonb_build_array(
    jsonb_build_object('id', left(md5(d.quiz_type || sc.stable_key || '|correct'), 8), 'text', d.correct, 'kind', 'correct'),
    jsonb_build_object('id', left(md5(d.quiz_type || sc.stable_key || '|near1'), 8), 'text', d.near1, 'kind', 'near'),
    jsonb_build_object('id', left(md5(d.quiz_type || sc.stable_key || '|near2'), 8), 'text', d.near2, 'kind', 'near'),
    jsonb_build_object('id', left(md5(d.quiz_type || sc.stable_key || '|near3'), 8), 'text', d.near3, 'kind', 'near')
  ),
  left(md5(d.quiz_type || sc.stable_key || '|correct'), 8)
FROM (VALUES
  -- 用途から選ぶ（文型の表現だけ）
  ('intent', 'REQUEST_COULD_YOU', '', 'Could you ...?', 'Could I ...?', 'Would you like to ...?', 'Did you ...?'),
  ('intent', 'CAUSE_THATS_WHY', '', 'That''s why ...', '... because ...', 'In my case, ...', 'I had no choice but to ...'),
  ('intent', 'CORRECTION_MEAN', '', 'I don''t mean ... I mean ...', 'Do you mean ...?', 'What does that mean?', 'I used to ..., but now ...'),
  ('intent', 'DESIRE_WANT_TO', '', 'I want to ...', 'I like ...', 'I am going to ...', 'I usually ...'),
  ('intent', 'DURATION_IT_TOOK', '', 'It took me ... to ...', 'I had no choice but to ...', 'I usually ...', 'I have been to ...'),
  ('intent', 'INVITATION_WOULD_YOU_LIKE', '', 'Would you like to ...?', 'Could you ...?', 'Could I ...?', 'Did you ...?'),
  ('intent', 'MEANING_CLARIFICATION', '', 'What does that mean?', 'Could you say that again?', 'How about you?', 'Why ...?'),
  ('intent', 'MEANING_CONFIRMATION', '', 'Do you mean ...?', 'Could you say that again?', 'Why ...?', 'How about you?'),
  ('intent', 'NO_CHOICE_BUT', '', 'I had no choice but to ...', 'I want to ...', 'That''s why ...', 'I used to ..., but now ...'),
  ('intent', 'PAST_VS_NOW', '', 'I used to ..., but now ...', 'I usually ...', 'I ... yesterday.', 'I am ...ing now.'),
  ('intent', 'PERMISSION_COULD_I', '', 'Could I ...?', 'Could you ...?', 'Would you like to ...?', 'Do you ...?'),
  ('intent', 'PERSONAL_CASE', '', 'In my case, ...', 'How about you?', 'I am ...', 'That''s why ...'),
  ('intent', 'PREFERENCE_LIKE_GERUND', '', 'I like ...', 'I want to ...', 'I usually ...', 'I have been to ...'),
  ('intent', 'QUESTION_BACK_HOW_ABOUT_YOU', '', 'How about you?', 'How about ...?', 'In my case, ...', 'What does that mean?'),
  ('intent', 'QUESTION_EXPERIENCE_HAVE_EVER', '', 'Have you ever ...?', 'Did you ...?', 'Do you ...?', 'I have been to ...'),
  ('intent', 'QUESTION_FAVORITE_WHAT', '', 'What is your favorite ...?', 'Do you ...?', 'How was ...?', 'I like ...'),
  ('intent', 'QUESTION_PAST_DID', '', 'Did you ...?', 'Do you ...?', 'Have you ever ...?', 'Are you ...?'),
  ('intent', 'QUESTION_PRESENT_DO', '', 'Do you ...?', 'Did you ...?', 'Have you ever ...?', 'How was ...?'),
  ('intent', 'QUESTION_REASON_WHY', '', 'Why ...?', 'How was ...?', 'What does that mean?', '... because ...'),
  ('intent', 'QUESTION_STATE_ARE', '', 'Are you ...?', 'Did you ...?', 'How was ...?', 'Have you ever ...?'),
  ('intent', 'QUESTION_STATE_HOW', '', 'How was ...?', 'Why ...?', 'Are you ...?', 'What is your favorite ...?'),
  ('intent', 'REASON_BECAUSE', '', '... because ...', 'That''s why ...', 'Why ...?', 'In my case, ...'),
  ('intent', 'REPEAT_REQUEST', '', 'Could you say that again?', 'What does that mean?', 'Could I ...?', 'How about you?'),
  ('intent', 'SELF_DESCRIPTION_BE', '', 'I am ...', 'I like ...', 'In my case, ...', 'I am ...ing now.'),
  ('intent', 'SUGGESTION_HOW_ABOUT', '', 'How about ...?', 'How about you?', 'Could you ...?', 'Did you ...?'),
  ('intent', 'TIME_EXPERIENCE_HAVE_BEEN', '', 'I have been to ...', 'Have you ever ...?', 'I ... yesterday.', 'I am going to ...'),
  ('intent', 'TIME_FUTURE_GOING_TO', '', 'I am going to ...', 'I am ...ing now.', 'I want to ...', 'I ... yesterday.'),
  ('intent', 'TIME_PAST_YESTERDAY', '', 'I ... yesterday.', 'I usually ...', 'I am going to ...', 'I have been to ...'),
  ('intent', 'TIME_PRESENT_PROGRESSIVE_NOW', '', 'I am ...ing now.', 'I usually ...', 'I am going to ...', 'I ... yesterday.'),
  ('intent', 'TIME_USUALLY', '', 'I usually ...', 'I am ...ing now.', 'I ... yesterday.', 'I used to ..., but now ...'),

  -- 意味を選ぶ
  ('meaning', 'REQUEST_COULD_YOU', 'Could you send me the file?', 'ファイルを送ってもらえますか？', 'ファイルを送ってもいいですか？', 'ファイルを送りましたか？', 'ファイルを送るつもりですか？'),
  ('meaning', 'CAUSE_THATS_WHY', 'That''s why I started learning English.', 'だから僕は英語を勉強し始めたんだ。', '英語を勉強し始めたのは、なぜだろう。', '僕の場合は英語を勉強し始めた。', '英語を勉強し始めるしかなかった。'),
  ('meaning', 'CORRECTION_MEAN', 'I don''t mean today. I mean tomorrow.', '今日という意味じゃない。明日という意味。', '今日ではなく明日と言いましたか？', '昔は今日だったが、今は明日だ。', '今日も明日も大丈夫という意味。'),
  ('meaning', 'DESIRE_WANT_TO', 'I want to improve my English.', '英語を上達させたいです。', '英語を上達させる予定です。', '英語が上達しました。', '英語を上達させるのが好きです。'),
  ('meaning', 'DURATION_IT_TOOK', 'It took me a long time to finish this project.', 'このプロジェクトを終えるまで長い時間がかかった。', 'このプロジェクトを長い間続けている。', 'このプロジェクトを終えるしかなかった。', 'このプロジェクトを終える時間がない。'),
  ('meaning', 'INVITATION_WOULD_YOU_LIKE', 'Would you like to grab lunch?', '一緒にランチに行きませんか？', 'ランチに行ってもいいですか？', 'ランチを取ってきてもらえますか？', 'ランチに行きましたか？'),
  ('meaning', 'MEANING_CLARIFICATION', 'What does that mean?', 'それはどういう意味？', 'もう一度言ってもらえますか？', 'それはなぜ？', 'あなたはどういうつもりで言ったの？'),
  ('meaning', 'MEANING_CONFIRMATION', 'Do you mean the meeting is canceled?', 'つまり会議は中止という意味？', '会議は中止になりましたか？', '会議は中止と言いましたか？', '会議を中止してもらえますか？'),
  ('meaning', 'NO_CHOICE_BUT', 'I had no choice but to cancel the meeting.', '会議をキャンセルするしかなかった。', '会議をキャンセルしたくなかった。', '会議をキャンセルする選択肢があった。', '会議をキャンセルする予定だ。'),
  ('meaning', 'PAST_VS_NOW', 'I used to live in Osaka, but now I live in Tokyo.', '昔は大阪に住んでいた。でも今は東京に住んでいる。', '普段は大阪に住んでいるが、今は東京にいる。', '大阪にも東京にも住んだことがある。', '大阪に住む予定だったが、東京に住んでいる。'),
  ('meaning', 'PERMISSION_COULD_I', 'Could I ask you something?', '何か聞いてもいいですか？', '何か聞いてもらえますか？', '何か聞きましたか？', '何を聞きたいですか？'),
  ('meaning', 'PERSONAL_CASE', 'In my case, I work from home.', '僕の場合は家で仕事をしている。', 'あなたは家で仕事をしていますか？', '僕は家で仕事をするしかない。', '僕は家で仕事をしたい。'),
  ('meaning', 'PREFERENCE_LIKE_GERUND', 'I like watching movies.', '映画を見るのが好きです。', '映画を見たいです。', '映画を見ています。', '映画を見たことがあります。'),
  ('meaning', 'QUESTION_BACK_HOW_ABOUT_YOU', 'How about you?', 'あなたは？', '一緒にどうですか？', '私の場合は。', 'それはどういう意味？'),
  ('meaning', 'QUESTION_EXPERIENCE_HAVE_EVER', 'Have you ever been abroad?', '海外に行ったことある？', '昨日海外に行った？', '海外に行く予定？', '海外にいるの？'),
  ('meaning', 'QUESTION_FAVORITE_WHAT', 'What''s your favorite food?', '好きな食べ物は何？', '何を食べたい？', '何を食べた？', '食べ物はどうだった？'),
  ('meaning', 'QUESTION_PAST_DID', 'Did you sleep well?', 'よく眠れた？', 'よく眠る？', '今よく眠ってる？', 'よく眠ったことある？'),
  ('meaning', 'QUESTION_PRESENT_DO', 'Do you drink coffee?', 'コーヒーを飲む？', 'コーヒーを飲んだ？', '今コーヒーを飲んでる？', 'コーヒーを飲みたい？'),
  ('meaning', 'QUESTION_REASON_WHY', 'Why were you late?', 'なぜ遅れたの？', '遅れたのはいつ？', 'どれくらい遅れたの？', '遅れてもいい？'),
  ('meaning', 'QUESTION_STATE_ARE', 'Are you free tomorrow?', '明日空いてるの？', '明日は暇だった？', '明日何をするの？', '明日は自由に使っていい？'),
  ('meaning', 'QUESTION_STATE_HOW', 'How was your weekend?', '週末はどうだった？', '週末は何をする？', '週末はどこへ行った？', '週末は好き？'),
  ('meaning', 'REASON_BECAUSE', 'I''m tired because I worked all night.', '一晩中作業したので疲れています。', '疲れているので一晩中作業しました。', '一晩中作業したが疲れていません。', '疲れたので一晩中休みました。'),
  ('meaning', 'REPEAT_REQUEST', 'Could you say that again?', 'もう一度言ってもらえますか？', 'もう一度説明してもらえますか？', 'もう一度言ってもいいですか？', 'それはどういう意味ですか？'),
  ('meaning', 'SELF_DESCRIPTION_BE', 'I''m a software engineer.', '私はソフトウェアエンジニアです。', '私はソフトウェアエンジニアになりたい。', '私はソフトウェアエンジニアだった。', '私はソフトウェアエンジニアが好きです。'),
  ('meaning', 'SUGGESTION_HOW_ABOUT', 'How about next Monday?', '来週の月曜はどう？', '来週の月曜はどうだった？', '来週の月曜に何をする？', '来週の月曜は空いてない。'),
  ('meaning', 'TIME_EXPERIENCE_HAVE_BEEN', 'I''ve been to Kyoto.', '京都に行ったことがある。', '京都に行く予定だ。', '京都に住んでいる。', '京都に行ったことはある？'),
  ('meaning', 'TIME_FUTURE_GOING_TO', 'I''m going to travel next month.', '来月旅行する予定。', '先月旅行した。', '来月旅行したい。', '今旅行している。'),
  ('meaning', 'TIME_PAST_YESTERDAY', 'I watched a movie yesterday.', '昨日映画を見た。', '昨日映画を見る予定だった。', '普段映画を見る。', '昨日映画を見ていない。'),
  ('meaning', 'TIME_PRESENT_PROGRESSIVE_NOW', 'I''m working now.', '今仕事をしている。', '普段仕事をしている。', '今から仕事をする予定。', '今仕事が終わった。'),
  ('meaning', 'TIME_USUALLY', 'I usually wake up at 7.', '普段は7時に起きる。', '今日は7時に起きた。', '7時に起きる予定。', '昔は7時に起きていた。'),
  ('meaning', 'CHUNK_FEEL_BETTER', 'feel better', '気分・体調が良くなる', '気分が悪くなる', '疲れを感じる', '楽しむ'),
  ('meaning', 'CHUNK_FEEL_GOOD', 'feel good', '気分がいい', '気分が悪い', '疲れを感じる', '楽しむ'),
  ('meaning', 'CHUNK_FEEL_LIKE', 'feel like pizza', 'ピザが食べたい気分', 'ピザが好き', 'ピザのような感じ', 'ピザを食べた'),
  ('meaning', 'CHUNK_FEEL_TIRED', 'feel tired', '疲れを感じる', '気分がいい', '眠りたい', '退屈だ'),
  ('meaning', 'CHUNK_GET_BETTER', 'get better', '良くなる', '気分がいい', '準備する', 'うまくいかない'),
  ('meaning', 'CHUNK_GET_HOME', 'get home', '家に着く', '帰る', '家にいる', '家を出る'),
  ('meaning', 'CHUNK_GET_READY', 'get ready', '準備する', '出かける', '休憩する', '急ぐ'),
  ('meaning', 'CHUNK_GET_TIRED', 'get tired', '疲れる', '退屈する', '休憩する', '良くなる'),
  ('meaning', 'CHUNK_GO_HOME', 'go home', '帰る', '家に着く', '家にいる', '出かける'),
  ('meaning', 'CHUNK_GO_OUT', 'go out', '出かける', '帰る', '外にいる', '家に着く'),
  ('meaning', 'CHUNK_GO_SHOPPING', 'go shopping', '買い物に行く', '買い物をした', '店で働く', '店を開く'),
  ('meaning', 'CHUNK_GO_WRONG', 'go wrong', 'うまくいかない', '道に迷う', 'うまくいく', '遅れる'),
  ('meaning', 'CHUNK_HAVE_BREAKFAST', 'have breakfast', '朝食をとる', '朝食を作る', '朝食がある', '昼食をとる'),
  ('meaning', 'CHUNK_HAVE_FUN', 'have fun', '楽しむ', '面白い', '楽しみにする', '冗談を言う'),
  ('meaning', 'CHUNK_HAVE_PROBLEM', 'have a problem', '問題がある', '問題を解く', '問題を出す', '心配する'),
  ('meaning', 'CHUNK_HAVE_TIME', 'have time', '時間がある', '時間がかかる', '時間を守る', '何時ですか'),
  ('meaning', 'CHUNK_TAKE_BREAK', 'take a break', '休憩する', '壊す', '寝る', '仕事を終える'),
  ('meaning', 'CHUNK_TAKE_BUS', 'take a bus', 'バスに乗る', 'バスを運転する', 'バスを待つ', 'バスを降りる'),
  ('meaning', 'CHUNK_TAKE_MEDICINE', 'take medicine', '薬を飲む', '薬を買う', '薬を作る', '病院に行く'),
  ('meaning', 'CHUNK_TAKE_SHOWER', 'take a shower', 'シャワーを浴びる', '風呂に入る', 'シャワーを直す', '顔を洗う'),

  -- 文を選ぶ
  ('form', 'REQUEST_COULD_YOU', 'ファイルを送ってもらえますか？', 'Could you send me the file?', 'Could I send you the file?', 'Did you send me the file?', 'Would you like to send me the file?'),
  ('form', 'CAUSE_THATS_WHY', 'だから僕は英語を勉強し始めたんだ。', 'That''s why I started learning English.', 'Because I started learning English.', 'That''s because I started learning English.', 'I started learning English because that.'),
  ('form', 'CORRECTION_MEAN', '今日という意味じゃない。明日という意味。', 'I don''t mean today. I mean tomorrow.', 'I don''t say today. I say tomorrow.', 'Do you mean today or tomorrow?', 'It doesn''t mean today. It means tomorrow.'),
  ('form', 'DESIRE_WANT_TO', '英語を上達させたいです。', 'I want to improve my English.', 'I''m going to improve my English.', 'I like improving my English.', 'I improved my English.'),
  ('form', 'DURATION_IT_TOOK', 'このプロジェクトを終えるまで長い時間がかかった。', 'It took me a long time to finish this project.', 'I took a long time finish this project.', 'It takes me a long time to finish this project.', 'I had no choice but to finish this project.'),
  ('form', 'INVITATION_WOULD_YOU_LIKE', '一緒にランチに行きませんか？', 'Would you like to grab lunch?', 'Could I grab lunch?', 'Could you grab lunch?', 'Did you grab lunch?'),
  ('form', 'MEANING_CLARIFICATION', 'それはどういう意味？', 'What does that mean?', 'What do you mean?', 'What did you say?', 'How do you say that?'),
  ('form', 'MEANING_CONFIRMATION', 'つまり会議は中止という意味？', 'Do you mean the meeting is canceled?', 'Did you cancel the meeting?', 'Was the meeting canceled?', 'Could you cancel the meeting?'),
  ('form', 'NO_CHOICE_BUT', '会議をキャンセルするしかなかった。', 'I had no choice but to cancel the meeting.', 'I had no choice but cancel the meeting.', 'I didn''t have to cancel the meeting.', 'I chose to cancel the meeting.'),
  ('form', 'PAST_VS_NOW', '昔は大阪に住んでいた。でも今は東京に住んでいる。', 'I used to live in Osaka, but now I live in Tokyo.', 'I usually live in Osaka, but now I live in Tokyo.', 'I am used to living in Osaka, but now I live in Tokyo.', 'I use to live in Osaka, but now I live in Tokyo.'),
  ('form', 'PERMISSION_COULD_I', '何か聞いてもいいですか？', 'Could I ask you something?', 'Could you ask me something?', 'Did I ask you something?', 'Would you like to ask something?'),
  ('form', 'PERSONAL_CASE', '僕の場合は家で仕事をしている。', 'In my case, I work from home.', 'In my case, I worked from home.', 'How about you? I work from home.', 'In case, I work from home.'),
  ('form', 'PREFERENCE_LIKE_GERUND', '映画を見るのが好きです。', 'I like watching movies.', 'I want to watch movies.', 'I''m watching movies.', 'I like watch movies.'),
  ('form', 'QUESTION_BACK_HOW_ABOUT_YOU', 'あなたは？', 'How about you?', 'How about it?', 'What about it?', 'Are you?'),
  ('form', 'QUESTION_EXPERIENCE_HAVE_EVER', '海外に行ったことある？', 'Have you ever been abroad?', 'Did you go abroad?', 'Have you ever gone to abroad?', 'Are you abroad?'),
  ('form', 'QUESTION_FAVORITE_WHAT', '好きな食べ物は何？', 'What''s your favorite food?', 'What food do you eat?', 'What''s your food favorite?', 'Do you like food?'),
  ('form', 'QUESTION_PAST_DID', 'よく眠れた？', 'Did you sleep well?', 'Do you sleep well?', 'Are you sleeping well?', 'Have you ever slept well?'),
  ('form', 'QUESTION_PRESENT_DO', 'コーヒーを飲む？', 'Do you drink coffee?', 'Did you drink coffee?', 'Are you drinking coffee?', 'Are you drink coffee?'),
  ('form', 'QUESTION_REASON_WHY', 'なぜ遅れたの？', 'Why were you late?', 'Why are you late?', 'Why did you late?', 'What made you say late?'),
  ('form', 'QUESTION_STATE_ARE', '明日空いてるの？', 'Are you free tomorrow?', 'Were you free tomorrow?', 'Do you free tomorrow?', 'Is free tomorrow?'),
  ('form', 'QUESTION_STATE_HOW', '週末はどうだった？', 'How was your weekend?', 'How is your weekend?', 'What was your weekend?', 'How will your weekend be?'),
  ('form', 'REASON_BECAUSE', '一晩中作業したので疲れています。', 'I''m tired because I worked all night.', 'I worked all night because I''m tired.', 'I''m tired. That''s why I worked all night.', 'I''m tired so I worked all night.'),
  ('form', 'REPEAT_REQUEST', 'もう一度言ってもらえますか？', 'Could you say that again?', 'Could you explain that again?', 'Could I say that again?', 'Could you tell that again?'),
  ('form', 'SELF_DESCRIPTION_BE', '私はソフトウェアエンジニアです。', 'I''m a software engineer.', 'I''m software engineer.', 'I do a software engineer.', 'I was a software engineer.'),
  ('form', 'SUGGESTION_HOW_ABOUT', '来週の月曜はどう？', 'How about next Monday?', 'How was next Monday?', 'How about last Monday?', 'Are you next Monday?'),
  ('form', 'TIME_EXPERIENCE_HAVE_BEEN', '京都に行ったことがある。', 'I''ve been to Kyoto.', 'I went to Kyoto.', 'I''ve gone to Kyoto.', 'I''m going to Kyoto.'),
  ('form', 'TIME_FUTURE_GOING_TO', '来月旅行する予定。', 'I''m going to travel next month.', 'I traveled next month.', 'I''m traveling now.', 'I want to travel next month.'),
  ('form', 'TIME_PAST_YESTERDAY', '昨日映画を見た。', 'I watched a movie yesterday.', 'I watch a movie yesterday.', 'I have watched a movie yesterday.', 'I was watch a movie yesterday.'),
  ('form', 'TIME_PRESENT_PROGRESSIVE_NOW', '今仕事をしている。', 'I''m working now.', 'I work now.', 'I worked now.', 'I''m going to work now.'),
  ('form', 'TIME_USUALLY', '普段は7時に起きる。', 'I usually wake up at 7.', 'I''m usually waking up at 7.', 'I woke up at 7.', 'I used to wake up at 7.'),
  ('form', 'CHUNK_FEEL_BETTER', '気分・体調が良くなる', 'feel better', 'feel good', 'feel gooder', 'become better'),
  ('form', 'CHUNK_FEEL_GOOD', '気分がいい', 'feel good', 'feel better', 'feel goodly', 'have good'),
  ('form', 'CHUNK_FEEL_LIKE', 'ピザが食べたい気分', 'feel like pizza', 'like pizza', 'feel pizza', 'want like pizza'),
  ('form', 'CHUNK_FEEL_TIRED', '疲れを感じる', 'feel tired', 'feel tiring', 'have tired', 'be tiring'),
  ('form', 'CHUNK_GET_BETTER', '良くなる', 'get better', 'feel good', 'get good', 'be best'),
  ('form', 'CHUNK_GET_HOME', '家に着く', 'get home', 'go home', 'get to home', 'reach to home'),
  ('form', 'CHUNK_GET_READY', '準備する', 'get ready', 'make ready', 'do ready', 'get readied'),
  ('form', 'CHUNK_GET_TIRED', '疲れる', 'get tired', 'feel tiring', 'get tiring', 'become tiring'),
  ('form', 'CHUNK_GO_HOME', '帰る', 'go home', 'get home', 'go to home', 'return to home'),
  ('form', 'CHUNK_GO_OUT', '出かける', 'go out', 'get out', 'go to out', 'go home'),
  ('form', 'CHUNK_GO_SHOPPING', '買い物に行く', 'go shopping', 'go to shopping', 'go shop', 'go for shopped'),
  ('form', 'CHUNK_GO_WRONG', 'うまくいかない', 'go wrong', 'go bad', 'get wrong', 'do wrong'),
  ('form', 'CHUNK_HAVE_BREAKFAST', '朝食をとる', 'have breakfast', 'have a breakfast', 'make breakfast', 'do breakfast'),
  ('form', 'CHUNK_HAVE_FUN', '楽しむ', 'have fun', 'have funny', 'do fun', 'make fun'),
  ('form', 'CHUNK_HAVE_PROBLEM', '問題がある', 'have a problem', 'make a problem', 'do a problem', 'take a problem'),
  ('form', 'CHUNK_HAVE_TIME', '時間がある', 'have time', 'take time', 'have the hour', 'spend time'),
  ('form', 'CHUNK_TAKE_BREAK', '休憩する', 'take a break', 'make a break', 'do a break', 'take a broken'),
  ('form', 'CHUNK_TAKE_BUS', 'バスに乗る', 'take a bus', 'take on a bus', 'make a bus', 'do a bus'),
  ('form', 'CHUNK_TAKE_MEDICINE', '薬を飲む', 'take medicine', 'drink medicine', 'eat medicine', 'have a medicine'),
  ('form', 'CHUNK_TAKE_SHOWER', 'シャワーを浴びる', 'take a shower', 'take a bath', 'bathe a shower', 'do a shower')
) AS d(quiz_type, skill_key, prompt, correct, near1, near2, near3)
JOIN skill_trainer.skill_concepts sc ON sc.stable_key = d.skill_key
ON CONFLICT (item_key, option_set_version) DO NOTHING;

DO $$
DECLARE
  staged INTEGER;
  bad_count INTEGER;
BEGIN
  SELECT count(*) INTO staged FROM skill_trainer.quiz_items WHERE skill_id IS NOT NULL;
  IF staged <> 130 THEN
    RAISE EXCEPTION 'quiz stages expected 130 skill items, got %', staged;
  END IF;
  SELECT count(*) INTO bad_count
  FROM skill_trainer.quiz_items qi
  WHERE (SELECT count(DISTINCT lower(option ->> 'text')) FROM jsonb_array_elements(qi.options) option) <> 4;
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'quiz has % items with duplicate options', bad_count;
  END IF;
END $$;
