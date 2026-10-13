-- クイッククイズ。混同の対の確認文から4択を作り、選択式の試行を文字入力のEvidenceと分けて残す。

CREATE TABLE IF NOT EXISTS skill_trainer.quiz_items (
  item_key            VARCHAR(100) NOT NULL,
  option_set_version  INTEGER NOT NULL CHECK (option_set_version > 0),
  probe_id            UUID NOT NULL REFERENCES skill_trainer.confusion_probes(probe_id),
  pair_id             UUID NOT NULL REFERENCES skill_trainer.confusion_pairs(pair_id),
  capability          VARCHAR(40) NOT NULL DEFAULT 'CONTRAST_SELECTION'
                        CHECK (capability = 'CONTRAST_SELECTION'),
  prompt              TEXT NOT NULL CHECK (length(prompt) > 0),
  options             JSONB NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 4),
  correct_option_id   VARCHAR(16) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_key, option_set_version)
);

CREATE TABLE IF NOT EXISTS skill_trainer.quiz_attempts (
  attempt_id          UUID PRIMARY KEY,
  submission_id       UUID NOT NULL UNIQUE,
  learner_key         VARCHAR(80) NOT NULL DEFAULT 'default',
  item_key            VARCHAR(100) NOT NULL,
  option_set_version  INTEGER NOT NULL,
  pair_id             UUID NOT NULL REFERENCES skill_trainer.confusion_pairs(pair_id),
  capability          VARCHAR(40) NOT NULL CHECK (capability = 'CONTRAST_SELECTION'),
  response_mode       VARCHAR(20) NOT NULL CHECK (response_mode = 'choice'),
  modality            VARCHAR(30) NOT NULL CHECK (modality = 'multiple_choice'),
  option_order        JSONB NOT NULL CHECK (jsonb_typeof(option_order) = 'array'),
  selected_option_id  VARCHAR(16) NOT NULL,
  correct_option_id   VARCHAR(16) NOT NULL,
  selected_kind       VARCHAR(10) NOT NULL CHECK (selected_kind IN ('correct', 'pair', 'near')),
  outcome             VARCHAR(20) NOT NULL CHECK (outcome IN ('success', 'failure')),
  latency_ms          INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  answered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (item_key, option_set_version)
    REFERENCES skill_trainer.quiz_items(item_key, option_set_version)
);

CREATE INDEX IF NOT EXISTS quiz_attempts_learner_answered_idx
  ON skill_trainer.quiz_attempts (learner_key, answered_at DESC);
CREATE INDEX IF NOT EXISTS quiz_attempts_pair_idx
  ON skill_trainer.quiz_attempts (pair_id, answered_at DESC);

DROP TRIGGER IF EXISTS quiz_attempts_append_only ON skill_trainer.quiz_attempts;
CREATE TRIGGER quiz_attempts_append_only
  BEFORE UPDATE OR DELETE ON skill_trainer.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION skill_trainer.reject_append_only_mutation();

CREATE TABLE IF NOT EXISTS skill_trainer.quiz_promotions (
  promotion_id  UUID PRIMARY KEY,
  learner_key   VARCHAR(80) NOT NULL DEFAULT 'default',
  pair_id       UUID NOT NULL REFERENCES skill_trainer.confusion_pairs(pair_id),
  promoted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quiz_promotions_pair_idx
  ON skill_trainer.quiz_promotions (learner_key, pair_id, promoted_at DESC);

ALTER TABLE skill_trainer.quiz_items OWNER TO job_control_api;
ALTER TABLE skill_trainer.quiz_attempts OWNER TO job_control_api;
ALTER TABLE skill_trainer.quiz_promotions OWNER TO job_control_api;

-- pair = 対のもう一方を同じ内容に当てた誤答。near = 同じ型で起きやすい誤り。
INSERT INTO skill_trainer.quiz_items
  (item_key, option_set_version, probe_id, pair_id, prompt, options, correct_option_id)
SELECT
  'QZ-CS-' || d.suffix,
  1,
  pr.probe_id,
  pr.pair_id,
  pr.prompt,
  jsonb_build_array(
    jsonb_build_object('id', left(md5(pr.probe_id::text || '|correct'), 8), 'text', pr.expected_text, 'kind', 'correct'),
    jsonb_build_object('id', left(md5(pr.probe_id::text || '|pair'), 8), 'text', d.pair_text, 'kind', 'pair'),
    jsonb_build_object('id', left(md5(pr.probe_id::text || '|near1'), 8), 'text', d.near1, 'kind', 'near'),
    jsonb_build_object('id', left(md5(pr.probe_id::text || '|near2'), 8), 'text', d.near2, 'kind', 'near')
  ),
  left(md5(pr.probe_id::text || '|correct'), 8)
FROM (VALUES
  ('0001', 'I stayed home. That''s why it was raining.', 'It was raining because I stayed home.', 'I stayed home so it was raining.'),
  ('0003', 'I was late. That''s why I missed the train.', 'I missed the train because I was late.', 'I was late so I missed the train.'),
  ('0002', 'It was raining because I stayed home.', 'I stayed home. That''s why it was raining.', 'It was raining. That''s because I stayed home.'),
  ('0004', 'I missed the train because I was late.', 'I was late. That''s why I missed the train.', 'I missed the train. That''s because I was late.'),

  ('0021', 'Have you ever been to Tokyo yesterday?', 'Do you go to Tokyo yesterday?', 'Are you going to Tokyo yesterday?'),
  ('0023', 'Have you ever drunk coffee this morning?', 'Do you drink coffee this morning?', 'Are you drinking coffee this morning?'),
  ('0022', 'Did you go to Tokyo?', 'Do you go to Tokyo?', 'Are you going to Tokyo?'),
  ('0024', 'Did you eat sushi?', 'Do you eat sushi?', 'Are you eating sushi?'),

  ('0031', 'Do you mean tomorrow?', 'Does that mean tomorrow?', 'Do you say tomorrow?'),
  ('0033', 'Do you mean three o''clock?', 'Does that mean three o''clock?', 'Do you say three o''clock?'),
  ('0032', 'Did you say tomorrow?', 'Are you saying tomorrow?', 'Do you say tomorrow?'),
  ('0034', 'Did you say three o''clock?', 'Are you saying three o''clock?', 'Do you say three o''clock?'),

  ('0041', 'Does that mean you don''t want to go?', 'Did you say you don''t want to go?', 'Do you mean you didn''t want to go?'),
  ('0043', 'Does that mean you are busy?', 'Did you say you are busy?', 'Do you mean you were busy?'),
  ('0042', 'Do you mean I don''t have to go?', 'Does that mean I must not go?', 'Does that mean you don''t have to go?'),
  ('0044', 'Do you mean today is impossible?', 'Does that mean today was impossible?', 'Did you say today is impossible?'),

  ('0051', 'Do you want me to send the file?', 'Are you saying that I sent the file?', 'Can I send the file?'),
  ('0053', 'Do you want me to stay here?', 'Are you saying that I stayed here?', 'Can I stay here?'),
  ('0052', 'Are you asking me to send the file?', 'Do you want to send the file?', 'Could you send the file?'),
  ('0054', 'Are you asking me to stay here?', 'Do you want to stay here?', 'Could you stay here?'),

  ('0061', 'Could you wait a moment?', 'Can I give you a moment?', 'Could I wait a moment?'),
  ('0063', 'Could you wait a moment to think?', 'Can I give you a moment to think?', 'Could you think for a moment?'),
  ('0062', 'Could you give me a moment?', 'Can I wait a moment?', 'Could I wait a moment?'),
  ('0064', 'Could you give me a moment here?', 'Can I wait here a moment?', 'Could I wait a moment here?'),

  ('0071', 'Could you open the window?', 'Can you open the window?', 'Did you open the window?'),
  ('0073', 'Could you check this?', 'Can you check this?', 'Did I check this?'),
  ('0072', 'Can I open the window?', 'Could I open the window?', 'Did you open the window?'),
  ('0074', 'Can I check this?', 'Could I check this?', 'Did you check this?'),

  ('0081', 'Do you drink coffee now?', 'Did you drink coffee now?', 'Have you ever drunk coffee now?'),
  ('0083', 'Do you study English now?', 'Did you study English now?', 'Are you going to study English now?'),
  ('0082', 'Are you drinking coffee?', 'Did you drink coffee?', 'Have you ever drunk coffee?'),
  ('0084', 'Are you studying English?', 'Did you study English?', 'Have you ever studied English?'),

  ('0091', 'What does that mean?', 'What did you say?', 'What do you say?'),
  ('0093', 'What does fine mean?', 'What did you say by fine?', 'How do you say fine?'),
  ('0092', 'What do you mean?', 'What did you say?', 'How do you say that?'),
  ('0094', 'What do you mean?', 'How do you say that?', 'What did you say?'),

  ('00a1', 'So, you''re saying tomorrow?', 'So, did you say tomorrow?', 'So, are you asking tomorrow?'),
  ('00a3', 'So, you''re saying you will not go?', 'So, you mean you did not go?', 'So, did you say you will not go?'),
  ('00a2', 'So, you mean tomorrow?', 'So, you''re asking tomorrow?', 'So, does that mean tomorrow?'),
  ('00a4', 'So, you mean you will not go?', 'So, you''re saying you did not go?', 'So, you''re asking me not to go?'),

  ('00b1', 'Are you saying that I should stay?', 'Do you want to stay?', 'Can I stay?'),
  ('00b3', 'Are you saying that I should send it?', 'Do you want to send it?', 'Can I send it?'),
  ('00b2', 'Are you asking me to stay?', 'Are you saying that you should stay?', 'Are you saying that I stayed?'),
  ('00b4', 'Are you asking me to send it?', 'Are you saying that you should send it?', 'Are you saying that I sent it?'),

  ('00c1', 'Are you talking about this file?', 'Are you looking at this file?', 'Did you refer to this file?'),
  ('00c3', 'Are you talking about Tanaka?', 'Are you talking to Tanaka?', 'Did you refer to Tanaka?'),
  ('00c2', 'Are you referring to this file?', 'Are you talking to this file?', 'Are you looking at this file?'),
  ('00c4', 'Are you referring to Tanaka?', 'Are you talking to Tanaka?', 'Did you talk about Tanaka?'),

  ('00d1', 'Could you say that again?', 'Can I explain that again?', 'Could you explain that?'),
  ('00d3', 'Could you say that again?', 'Could you show me that again?', 'Can I explain that again?'),
  ('00d2', 'Could you explain that again?', 'Can I say that again?', 'Could you tell that again?'),
  ('00d4', 'Could you explain that again?', 'Could you tell that again?', 'Can I say that again?'),

  ('00e1', 'Could you explain it?', 'Could you say that again?', 'Could you give me an example?'),
  ('00e3', 'Could you explain the part?', 'Could you show me the part?', 'Could you say that again?'),
  ('00e2', 'Could you be more specific about the plan?', 'Could you show me the plan?', 'Can I explain the plan?'),
  ('00e4', 'Could you be more specific about the delay?', 'Could you say the delay?', 'Can I explain the delay?'),

  ('00f1', 'Could you show me?', 'Can I give you an example?', 'Could you be more specific?'),
  ('00f3', 'Could you show me?', 'Can I give you an example?', 'Could you explain that again?'),
  ('00f2', 'Could you give me an example?', 'Can I show you?', 'Could you tell me?'),
  ('00f4', 'Could you give me an example of the screen?', 'Can I show you the screen?', 'Could you look at the screen?'),

  ('0101', 'Could you check this number?', 'Can you check this number?', 'Did I check this number?'),
  ('0103', 'Could you check this schedule?', 'Can you check this schedule?', 'Did I check this schedule?'),
  ('0102', 'Can I check this number?', 'Could I check this number?', 'Did you check this number?'),
  ('0104', 'Can I check this schedule?', 'Could I check this schedule?', 'Did you check this schedule?'),

  ('0111', 'What happened?', 'What will happen next?', 'What is happening next?'),
  ('0113', 'What happened?', 'What will happen after the meeting?', 'What is happening next?'),
  ('0112', 'What happened next?', 'What is happening?', 'What will happen?'),
  ('0114', 'What happened next this morning?', 'What is happening this morning?', 'What will happen this morning?'),

  ('0121', 'Why that?', 'What do you mean by that?', 'What makes you do that?'),
  ('0123', 'Why that?', 'What do you mean by that?', 'What makes you do that?'),
  ('0122', 'What makes you say you were late?', 'Why are you late?', 'Why did you say late?'),
  ('0124', 'What makes you say no?', 'Why do you say no?', 'Why did you tell no?'),

  ('0131', 'What are you going to do?', 'What do you do?', 'What did you do?'),
  ('0133', 'What are you going to do now?', 'What do you do now?', 'What did you do now?'),
  ('0132', 'What are you doing?', 'What did you do?', 'What do you do?'),
  ('0134', 'What are you doing now?', 'What did you do tonight?', 'What do you do tonight?'),

  ('0141', 'Were you cooking yesterday?', 'Do you cook yesterday?', 'Have you ever cooked yesterday?'),
  ('0143', 'Were you reading the email this morning?', 'Do you read the email this morning?', 'Are you reading the email this morning?'),
  ('0142', 'Did you cook then?', 'Are you cooking then?', 'Have you ever cooked then?'),
  ('0144', 'Did you read the email then?', 'Are you reading the email then?', 'Do you read the email then?'),

  ('0151', 'Could you open the window?', 'Can I open the window?', 'Could I open the window?'),
  ('0153', 'I could swim.', 'I can swimming.', 'I am able swim.'),
  ('0152', 'Can you open the window?', 'Could I open the window?', 'Can I open the window?'),
  ('0154', 'I can swim.', 'I could swimming.', 'I can swam.'),

  ('0161', 'I will study tonight.', 'I study tonight.', 'I studied tonight.'),
  ('0163', 'I will go to Osaka next week.', 'I went to Osaka next week.', 'I am going to go Osaka next week.'),
  ('0162', 'I am going to study tonight.', 'I study tonight.', 'I studied tonight.'),

  ('0171', 'I would like to drink coffee.', 'I want drink coffee.', 'I wanted to drink coffee.'),
  ('0173', 'I would like to make a reservation.', 'I want make a reservation.', 'I wanted to make a reservation.'),
  ('0172', 'I want to drink coffee.', 'I would like drink coffee.', 'I like to drink coffee.'),
  ('0174', 'I want to make a reservation.', 'I would like make a reservation.', 'I like to make a reservation.'),

  ('0181', 'Do you have some coffee?', 'Do you have many coffee?', 'Are you have any coffee?'),
  ('0183', 'I do not have some time.', 'I do not have many time.', 'I have not any time.'),
  ('0182', 'I have any coffee.', 'I have many coffee.', 'I have few coffee.'),
  ('0184', 'I have any time.', 'I have many time.', 'I have few time.'),

  ('0191', 'I have much books.', 'I have many book.', 'I have much book.'),
  ('0193', 'I have much questions.', 'I have many question.', 'I have much question.'),
  ('0192', 'I have many water.', 'I have many waters.', 'I have much waters.'),
  ('0194', 'I do not have many time.', 'I do not have many times.', 'I do not have much times.'),

  ('01a1', 'Tell thank you.', 'Speak thank you.', 'Talk thank you.'),
  ('01a3', 'Tell your name.', 'Speak your name.', 'Talk your name.'),
  ('01a2', 'Say Tanaka thank you.', 'Speak Tanaka thank you.', 'Talk Tanaka thank you.'),
  ('01a4', 'Say me your name.', 'Speak me your name.', 'Talk me your name.'),

  ('01b1', 'See that sign.', 'Watch that sign.', 'Look that sign.'),
  ('01b3', 'See the map.', 'Watch the map.', 'Look the map.'),
  ('01b2', 'Do you look at that sign?', 'Do you watch that sign?', 'Are you seeing that sign?'),
  ('01b4', 'Do you look at the map?', 'Do you watch the map?', 'Are you seeing the map?'),

  ('01c1', 'Watch the bird.', 'See the bird.', 'Look the bird.'),
  ('01c3', 'Watch the child.', 'See the child.', 'Look the child.'),
  ('01c2', 'Look at the bird.', 'See the bird.', 'Watch at the bird.'),
  ('01c4', 'Look at the child.', 'See the child.', 'Watch at the child.'),

  ('01d1', 'Do you watch the sea?', 'Do you look at the sea?', 'Are you watching the sea?'),
  ('01d3', 'Do you watch the stars?', 'Do you look at the stars?', 'Are you watching the stars?'),
  ('01d2', 'See the waves.', 'Look the waves.', 'Watch at the waves.'),
  ('01d4', 'See the game.', 'Look the game.', 'Watch at the game.'),

  ('01e1', 'Do you listen to the music?', 'Do you listen the music?', 'Are you hearing to the music?'),
  ('01e3', 'Do you listen to the noise outside?', 'Do you listen the noise outside?', 'Are you hearing to the noise outside?'),
  ('01e2', 'Hear the music.', 'Listen the music.', 'Hear to the music.'),
  ('01e4', 'Hear me.', 'Listen me.', 'Hear to me.'),

  ('01f1', 'I got a new work.', 'I got new job.', 'I got a new jobs.'),
  ('01f3', 'Is the work busy?', 'Is the job busily?', 'Does the job busy?'),
  ('01f2', 'I job at home today.', 'I working at home today.', 'I do job at home today.'),
  ('01f4', 'Do you job at night?', 'Are you work at night?', 'Do you working at night?'),

  ('0201', 'The trip was funny.', 'The trip was a fun.', 'The trip is fun.'),
  ('0203', 'The game is funny.', 'The game was fun.', 'The game is a fun.'),
  ('0202', 'The story was fun.', 'The story is funny.', 'The story was a funny.'),
  ('0204', 'The picture is fun.', 'The picture was funny.', 'The picture is a funny.')
) AS d(suffix, pair_text, near1, near2)
JOIN skill_trainer.confusion_probes pr
  ON pr.probe_id = ('11111111-1111-4111-8111-00000000' || d.suffix)::uuid
ON CONFLICT (item_key, option_set_version) DO NOTHING;

DO $$
DECLARE
  item_count INTEGER;
  bad_count INTEGER;
BEGIN
  SELECT count(*) INTO item_count FROM skill_trainer.quiz_items WHERE option_set_version = 1;
  IF item_count <> 127 THEN
    RAISE EXCEPTION 'quick quiz seed expected 127 items, got %', item_count;
  END IF;
  SELECT count(*) INTO bad_count
  FROM skill_trainer.quiz_items qi
  WHERE (SELECT count(DISTINCT lower(option ->> 'text')) FROM jsonb_array_elements(qi.options) option) <> 4;
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'quick quiz has % items with duplicate options', bad_count;
  END IF;
END $$;
