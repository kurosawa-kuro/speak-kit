import { pool } from "./test-db.mjs"
import assert from "node:assert/strict"
import test from "node:test"
import { dispatch } from "../lib/dispatch.mjs"

test("choice golden path does not require an AI key", async () => {
  delete process.env.ANTHROPIC_API_KEY
  const plan = await dispatch("skill_trainer_get_today_plan_v2", {})
  assert.equal(plan.ok, true)
  assert.equal(plan.code, "ok")
  assert.ok(Array.isArray(plan.data.plan))

  const quiz = await dispatch("skill_trainer_quiz_next_v1", {})
  assert.equal(quiz.ok, true)
  assert.ok(quiz.data.item?.itemKey)
  const item = quiz.data.item
  const submitted = await dispatch("skill_trainer_submit_attempt_v2", {
    response_mode: "choice",
    submission_id: crypto.randomUUID(),
    item_key: item.itemKey,
    option_set_version: item.optionSetVersion,
    selected_option_id: item.options[0].id,
    option_order: item.options.map((option) => option.id),
    latency_ms: 12,
  })
  assert.equal(submitted.ok, true, JSON.stringify(submitted))
  assert.equal(submitted.code, "ok")
  assert.ok(submitted.data.outcome === "success" || submitted.data.outcome === "failure")

  const progress = await dispatch("skill_trainer_get_progress_v2", {})
  assert.equal(progress.ok, true)
  assert.ok(progress.data.skills.length > 0)
  assert.ok(progress.data.quickQuiz.itemCount >= 1)
  const choiceGraded = [...progress.data.quickQuiz.pairs, ...progress.data.quickQuiz.skills]
    .reduce((sum, entry) => sum + entry.choiceGraded, 0)
  assert.ok(choiceGraded >= 1)

  const freeText = await dispatch("skill_trainer_submit_attempt_v2", {
    response_mode: "free_text",
    attempt_id: crypto.randomUUID(),
    exercise_instance_id: crypto.randomUUID(),
    answer_text: "hello",
  })
  assert.equal(freeText.ok, false)
  assert.equal(freeText.code, "not_found")
  const talk = await dispatch("skill_trainer_start_talk_session_v2", {
    scenario: "teacher",
    session_id: crypto.randomUUID(),
  })
  assert.equal(talk.ok, true, JSON.stringify(talk))
  assert.equal(typeof talk.data.assistantMessage, "string")
})

test("unknown rpc is absent", async () => {
  assert.equal(await dispatch("skill_trainer_audio_v1", {}), null)
})

test.after(async () => {
  await pool.end()
})
