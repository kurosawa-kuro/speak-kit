import { pool } from "./test-db.mjs"
import assert from "node:assert/strict"
import test from "node:test"
import { dispatch } from "../lib/dispatch.mjs"
import { reviewCandidate } from "../lib/candidates.mjs"

const originalFetch = globalThis.fetch
const originalKey = process.env.ANTHROPIC_API_KEY
let anthropicCalls = 0

test.before(() => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("anthropic.com")) {
      anthropicCalls += 1
      return new Response(JSON.stringify({ error: { message: "stubbed" } }), { status: 500 })
    }
    return originalFetch(url, init)
  }
})

test.after(async () => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalKey
  await pool.end()
})

async function twoRecallSkills() {
  const { rows } = await pool.query(
    `SELECT DISTINCT sc.stable_key
     FROM skill_trainer.exercise_definitions ed
     JOIN skill_trainer.skill_concepts sc ON sc.id = ed.target_skill_id
     WHERE ed.status = 'active' AND sc.status = 'active' AND sc.phase = 1 AND ed.training_mode = 'controlled_recall'
     ORDER BY sc.stable_key LIMIT 2`,
  )
  return rows.map((row) => row.stable_key)
}

test("A7: 練習の再送は、同じ skill_key なら同じ問題、違う skill_key なら別の問題を返す", async () => {
  delete process.env.ANTHROPIC_API_KEY
  const [first, second] = await twoRecallSkills()
  const practiceId = crypto.randomUUID()
  const a = await dispatch("skill_trainer_get_practice_v2", { practice_id: practiceId, training_mode: "controlled_recall", skill_key: first })
  assert.equal(a.ok, true, JSON.stringify(a))
  assert.equal(a.data.skill.skillKey, first)
  const replay = await dispatch("skill_trainer_get_practice_v2", { practice_id: practiceId, training_mode: "controlled_recall", skill_key: first })
  assert.equal(replay.data.exercise.exerciseInstanceId, a.data.exercise.exerciseInstanceId)
  assert.equal(replay.data.exercise.prompt, a.data.exercise.prompt)
  const b = await dispatch("skill_trainer_get_practice_v2", { practice_id: practiceId, training_mode: "controlled_recall", skill_key: second })
  assert.equal(b.data.skill.skillKey, second)
  assert.notEqual(b.data.exercise.exerciseInstanceId, a.data.exercise.exerciseInstanceId)
  assert.equal(b.data.exercise.exerciseKey.length > 0, true)
})

test("A6: 同じ再判定の再送では AI を呼ばない", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real"
  const [skill] = await twoRecallSkills()
  const practice = await dispatch("skill_trainer_get_practice_v2", { practice_id: crypto.randomUUID(), training_mode: "controlled_recall", skill_key: skill })
  const attemptId = crypto.randomUUID()
  const submitted = await dispatch("skill_trainer_submit_attempt_v2", {
    response_mode: "free_text",
    attempt_id: attemptId,
    exercise_instance_id: practice.data.exercise.exerciseInstanceId,
    answer_text: "something completely different",
    latency_ms: 1000,
  })
  assert.equal(submitted.ok, true, JSON.stringify(submitted))
  const regradeId = crypto.randomUUID()
  const first = await dispatch("skill_trainer_regrade_attempt_v2", { regrade_id: regradeId, attempt_id: attemptId })
  assert.equal(first.ok, true, JSON.stringify(first))
  const callsAfterFirst = anthropicCalls
  const again = await dispatch("skill_trainer_regrade_attempt_v2", { regrade_id: regradeId, attempt_id: attemptId })
  assert.equal(again.code, "idempotent_replay")
  assert.equal(again.data.gradingId, first.data.gradingId)
  assert.equal(anthropicCalls, callsAfterFirst)
  delete process.env.ANTHROPIC_API_KEY
})

test("A5: 確認問題の回答は、送った submissionId をそのまま返す", async () => {
  const { rows } = await pool.query("SELECT probe_id FROM skill_trainer.confusion_probes ORDER BY probe_id LIMIT 1")
  const submissionId = crypto.randomUUID()
  const result = await dispatch("skill_trainer_submit_attempt_v2", {
    response_mode: "confusion_probe",
    submission_id: submissionId,
    probe_id: rows[0].probe_id,
    answer_text: "test answer",
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.data.submissionId, submissionId)
})

test("A4: 会話での使用の判定は、短縮形を広げた形でも一致する", async () => {
  delete process.env.ANTHROPIC_API_KEY
  const started = await dispatch("skill_trainer_start_talk_session_v2", { scenario: "teacher", session_id: crypto.randomUUID() })
  assert.equal(started.ok, true, JSON.stringify(started))
  const sent = await dispatch("skill_trainer_send_talk_message_v2", {
    conversation_session_id: started.data.conversationSessionId,
    turn_id: crypto.randomUUID(),
    message: "That is why I started learning English",
    latency_ms: 3000,
  })
  assert.equal(sent.ok, true, JSON.stringify(sent))
  assert.ok(sent.data.attributedSkillKeys.includes("CAUSE_THATS_WHY"), JSON.stringify(sent.data.attributedSkillKeys))
})

test("A10: 候補の承認で作る練習問題は、自分の採点契約を指す", async () => {
  const { rows } = await pool.query(
    `INSERT INTO skill_trainer.candidate_skills (pattern, meaning, need_count)
     VALUES ('I was about to say that.', 'ちょうど言おうとしていた', 1) RETURNING id`,
  )
  const candidateId = Number(rows[0].id)
  const approved = await reviewCandidate({
    candidate_id: candidateId,
    decision: "approved",
    reviewed_by: "test",
    stable_key: `TEST_CANDIDATE_${candidateId}`,
    canonical_form: "I was about to say that.",
    exercise_prompt: "ちょうど言おうとしていた",
    expected_reference: "I was about to say that.",
    category: "OUTPUT",
  })
  assert.equal(approved.ok, true, JSON.stringify(approved))
  const contract = await pool.query(
    `SELECT ed.assessment_contract_key, ac.contract_key
     FROM skill_trainer.exercise_definitions ed
     JOIN skill_trainer.assessment_contracts ac
       ON ac.contract_key = ed.assessment_contract_key AND ac.version = ed.assessment_contract_version
     WHERE ed.exercise_key = $1`,
    [`CANDIDATE-${candidateId}-CR`],
  )
  assert.equal(contract.rows[0].assessment_contract_key, `adaptive:CANDIDATE-${candidateId}-CR`)
})
