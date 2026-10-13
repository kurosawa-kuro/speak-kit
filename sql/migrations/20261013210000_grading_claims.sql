-- 後回しにした採点を、いまどこかが進めている印。同じ回答を AI に二重に出さないために使う。
-- 採点を書き込んだら消す。古い印（2 分より前）は、止まったものとして取り直してよい。

CREATE TABLE skill_trainer.grading_claims (
    attempt_id uuid PRIMARY KEY REFERENCES skill_trainer.training_attempts(attempt_id),
    claimed_at timestamp with time zone DEFAULT now() NOT NULL
);
