/** 元の skill-trainer と同じ 16 個。 */
export const REFERENCE_RPC_NAMES = [
  "skill_trainer_get_today_plan_v2",
  "skill_trainer_get_practice_v2",
  "skill_trainer_submit_attempt_v2",
  "skill_trainer_register_confusion_pair_v2",
  "skill_trainer_regrade_attempt_v2",
  "skill_trainer_record_human_observation_v2",
  "skill_trainer_compare_observations_v2",
  "skill_trainer_get_progress_v2",
  "skill_trainer_reset_review_v2",
  "skill_trainer_quiz_next_v1",
  "skill_trainer_start_talk_session_v2",
  "skill_trainer_send_talk_message_v2",
  "skill_trainer_end_talk_session_v2",
  "skill_trainer_get_trace_v2",
  "skill_trainer_evaluate_phase_gate_v2",
  "skill_trainer_review_candidate_v2",
]

/** speak-kit で足したもの。 */
export const LOCAL_RPC_NAMES = [
  "skill_trainer_get_settings_v1",
  "skill_trainer_save_settings_v1",
]

export const RPC_NAMES = [...REFERENCE_RPC_NAMES, ...LOCAL_RPC_NAMES]
