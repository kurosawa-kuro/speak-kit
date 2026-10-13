-- 英会話学習アプリ: Core seed本編(migration 8)で投入した型(reusable parts)のうち28件が
-- canonical_pattern/meaningに「...」「〜」「A/B」のようなプレースホルダーを含み、具体的な
-- 一文になっていなかった（owner実機確認で指摘: 2026-10-07「これはそもそものデータが問題」）。
-- Controlled Recallは「日本語の意味に対して英語を生成する」訓練であり、意味自体が
-- プレースホルダーのままでは学習者が何を埋めるべきか分からず詰まる。各行を具体的で
-- 自然な一文（型の一例）へ置き換える。
-- Tier1チャンク1件（feel like ...）も同種の問題のため、チャンクらしい短い形
-- （get home/take a break等の既存の型に揃える）で修正する。
-- idではなく旧canonical_pattern（UNIQUE制約により一意）でマッチする
-- （idはBIGSERIALの割り当て順に依存し、将来migration 8が変わった場合に脆い）。
-- skill_idはskill_states/weaknesses/training_eventsから参照されるため変更しない
-- （UPDATEのみ・INSERT/DELETEはしない）。
-- Applied by `skill-trainer skill-trainer-local-schema-apply` as the admin role (DB_FLOW_URL).

UPDATE skill_trainer.skills SET canonical_pattern = 'I''m a software engineer.', meaning = '私はソフトウェアエンジニアです。' WHERE canonical_pattern = 'I''m ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'I like watching movies.', meaning = '映画を見るのが好きです。' WHERE canonical_pattern = 'I like ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'I want to improve my English.', meaning = '英語を上達させたいです。' WHERE canonical_pattern = 'I want to ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'I''m tired because I worked all night.', meaning = '一晩中作業したので疲れています。' WHERE canonical_pattern = 'I ... because ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'It took me a long time to finish this project.', meaning = 'このプロジェクトを終えるまで長い時間がかかった。' WHERE canonical_pattern = 'It took me a long time to ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'That''s why I started learning English.', meaning = 'だから僕は英語を勉強し始めたんだ。' WHERE canonical_pattern = 'That''s why I ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'In my case, I work from home.', meaning = '僕の場合は家で仕事をしている。' WHERE canonical_pattern = 'In my case, ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'I had no choice but to cancel the meeting.', meaning = '会議をキャンセルするしかなかった。' WHERE canonical_pattern = 'I had no choice but to ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'I used to live in Osaka, but now I live in Tokyo.', meaning = '昔は大阪に住んでいた。でも今は東京に住んでいる。' WHERE canonical_pattern = 'I used to ..., but now ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'I don''t mean today. I mean tomorrow.', meaning = '今日という意味じゃない。明日という意味。' WHERE canonical_pattern = 'I don''t mean A. I mean B.';
UPDATE skill_trainer.skills SET canonical_pattern = 'Do you drink coffee?', meaning = 'コーヒーを飲む？' WHERE canonical_pattern = 'Do you ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'Did you sleep well?', meaning = 'よく眠れた？' WHERE canonical_pattern = 'Did you ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'Are you free tomorrow?', meaning = '明日空いてるの？' WHERE canonical_pattern = 'Are you ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'What''s your favorite food?', meaning = '好きな食べ物は何？' WHERE canonical_pattern = 'What ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'Why were you late?', meaning = 'なぜ遅れたの？' WHERE canonical_pattern = 'Why ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'How was your weekend?', meaning = '週末はどうだった？' WHERE canonical_pattern = 'How ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'Have you ever been abroad?', meaning = '海外に行ったことある？' WHERE canonical_pattern = 'Have you ever ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'I usually wake up at 7.', meaning = '普段は7時に起きる。' WHERE canonical_pattern = 'I usually ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'I watched a movie yesterday.', meaning = '昨日映画を見た。' WHERE canonical_pattern = 'I ... yesterday.';
UPDATE skill_trainer.skills SET canonical_pattern = 'I''m working now.', meaning = '今仕事をしている。' WHERE canonical_pattern = 'I''m ...ing now.';
UPDATE skill_trainer.skills SET canonical_pattern = 'I''m going to travel next month.', meaning = '来月旅行する予定。' WHERE canonical_pattern = 'I''m going to ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'I''ve been to Kyoto.', meaning = '京都に行ったことがある。' WHERE canonical_pattern = 'I''ve been to ...';
UPDATE skill_trainer.skills SET canonical_pattern = 'Could I ask you something?', meaning = '何か聞いてもいいですか？' WHERE canonical_pattern = 'Could I ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'Could you send me the file?', meaning = 'ファイルを送ってもらえますか？' WHERE canonical_pattern = 'Could you ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'Would you like to grab lunch?', meaning = '一緒にランチに行きませんか？' WHERE canonical_pattern = 'Would you like to ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'How about next Monday?', meaning = '来週の月曜はどう？' WHERE canonical_pattern = 'How about ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'Do you mean the meeting is canceled?', meaning = 'つまり会議は中止という意味？' WHERE canonical_pattern = 'Do you mean ...?';
UPDATE skill_trainer.skills SET canonical_pattern = 'feel like pizza', meaning = 'ピザが食べたい気分' WHERE canonical_pattern = 'feel like ...';
