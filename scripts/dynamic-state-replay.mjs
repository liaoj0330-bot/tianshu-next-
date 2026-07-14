import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openStore } from "../src/core/store.mjs";
import {
  answerStateQuestion,
  createStateSubject,
  decideStateUpdate,
  getCurrentState,
  listStateHistory,
  proposeStateUpdate,
  renderStateDecisionCardMarkdown,
} from "../src/state/dynamic-state.mjs";

const runtime = resolve(".dynamic-state-replay-runtime");
rmSync(runtime, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });
const db = openStore(join(runtime, "state.sqlite"));
const { subject_id: subjectId } = createStateSubject(db, {
  subject_id: "controlled_replay_creator",
  display_name: "阶段 B 工程回放",
  initial_state: {
    stable: { direction: "higher_education_ai" },
    current: { stage: "static_profile", primary_focus: "adoption_validation" },
    future: { desired_state: "dynamic_state_understanding" },
  },
  source: { type: "controlled_replay", reference: "engineering replay fixture" },
});

const questionKeysByCycle = [];
const cards = [];

const cycle1 = proposeStateUpdate(db, subjectId, {
  observed_at: "2026-07-13T09:00:00.000Z",
  signals: [
    { path: "current.stage", operation: "set", value: "dynamic_state_validation", confidence: "high", source_type: "controlled_replay" },
    { path: "current.next_focus", operation: "set", value: "run_three_state_cycles", confidence: "high", source_type: "controlled_replay" },
  ],
  candidate_actions: [{ text: "运行下一轮状态比较", reason: "需要连续验证", priority: 10 }],
}, { mode: "controlled_replay" });
cards.push(cycle1.decision_card);
questionKeysByCycle.push(cycle1.decision_card.questions.map((question) => question.key));
renderStateDecisionCardMarkdown(db, cycle1.cycle_id, join(runtime, "cycle-1.md"));
decideStateUpdate(db, cycle1.cycle_id, "accept", { reason: "Controlled replay acceptance." });

const cycle2 = proposeStateUpdate(db, subjectId, {
  observed_at: "2026-07-13T10:00:00.000Z",
  signals: [{
    path: "current.partner_level",
    operation: "set",
    value: "key_partner_direct",
    confidence: "medium",
    source_type: "controlled_replay",
    question: {
      key: "partner-evidence",
      text: "是否已有关键合作方直接参与的可核实证据？",
      why_it_matters: "该证据会影响项目等级和优先级。",
      priority: 10,
    },
  }],
  candidate_actions: [{ text: "先核实合作方参与证据", reason: "中等置信度不能直接升级项目", priority: 10 }],
}, { mode: "controlled_replay" });
cards.push(cycle2.decision_card);
questionKeysByCycle.push(cycle2.decision_card.questions.map((question) => question.key));
renderStateDecisionCardMarkdown(db, cycle2.cycle_id, join(runtime, "cycle-2.md"));
decideStateUpdate(db, cycle2.cycle_id, "accept", { reason: "No state change without evidence." });
answerStateQuestion(db, subjectId, "partner-evidence", "Controlled fixture supplies verification in cycle 3.");

const cycle3 = proposeStateUpdate(db, subjectId, {
  observed_at: "2026-07-13T11:00:00.000Z",
  signals: [
    { path: "current.partner_level", operation: "set", value: "key_partner_direct", confidence: "high", source_type: "controlled_replay" },
    { path: "current.primary_focus", operation: "set", value: "key_partner_adoption_path", confidence: "high", source_type: "controlled_replay" },
    { path: "current.next_focus", operation: "invalidate", confidence: "high", source_type: "controlled_replay", reason: "Old next focus completed." },
  ],
  candidate_actions: [{ text: "形成关键合作方采用路径验证任务", reason: "合作结构变化已获得回放证据", priority: 10 }],
}, { mode: "controlled_replay" });
cards.push(cycle3.decision_card);
questionKeysByCycle.push(cycle3.decision_card.questions.map((question) => question.key));
renderStateDecisionCardMarkdown(db, cycle3.cycle_id, join(runtime, "cycle-3.md"));
decideStateUpdate(db, cycle3.cycle_id, "accept", { reason: "Controlled replay evidence accepted." });

const allQuestionKeys = questionKeysByCycle.flat();
const result = {
  mode: "controlled_replay",
  engineering_validation: true,
  product_stage_b_accepted: false,
  disclaimer: "Controlled replay is not a real creator validation cycle.",
  cycles: cards.map((card) => ({
    cycle_id: card.cycle_id,
    changes: card.changes.length,
    questions: card.questions.length,
    next_action: card.next_action.text,
  })),
  repeated_question_keys: allQuestionKeys.filter((key, index) => allQuestionKeys.indexOf(key) !== index),
  snapshot_count: listStateHistory(db, subjectId).length,
  current_state: getCurrentState(db, subjectId).state,
};
writeFileSync(join(runtime, "replay-report.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
db.close();
