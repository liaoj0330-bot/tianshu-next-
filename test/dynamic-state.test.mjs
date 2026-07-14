import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import {
  answerStateQuestion,
  buildStateDecisionCard,
  createStateSubject,
  decideStateUpdate,
  getCurrentState,
  listStateHistory,
  proposeStateUpdate,
  renderStateDecisionCardMarkdown,
} from "../src/state/dynamic-state.mjs";

const runtime = resolve(".dynamic-state-test-runtime");
let db;
let subjectId;

function initialState(overrides = {}) {
  return {
    stable: { identity: "AI education creator", ...(overrides.stable ?? {}) },
    current: { stage: "static_profile", primary_focus: "higher_ed", ...(overrides.current ?? {}) },
    future: { desired_state: "dynamic_assistant", ...(overrides.future ?? {}) },
  };
}

beforeEach(() => {
  db?.close();
  rmSync(runtime, { recursive: true, force: true });
  db = openStore(join(runtime, "state.sqlite"));
  ({ subject_id: subjectId } = createStateSubject(db, {
    subject_id: "creator",
    display_name: "Creator",
    initial_state: initialState(),
    source: { type: "creator_explicit", reference: "test baseline" },
  }));
});

test("accepted updates create immutable snapshots and keep stable/current/future separate", () => {
  const { cycle_id: cycleId, decision_card: card } = proposeStateUpdate(db, subjectId, {
    observed_at: "2026-07-13T09:00:00.000Z",
    signals: [
      { path: "current.stage", operation: "set", value: "dynamic_validation", confidence: "high", source_type: "creator_explicit" },
      { path: "future.desired_state", operation: "set", value: "long_term_companion", confidence: "high", source_type: "creator_explicit" },
      {
        path: "stable.identity",
        operation: "set",
        value: "temporary_mood",
        confidence: "high",
        source_type: "inference",
        question: { key: "identity-change", text: "是否确认长期身份变化？", why_it_matters: "临时信号不能改写身份。", priority: 10 },
      },
    ],
    candidate_actions: [
      { text: "低优先动作", priority: 1 },
      { text: "运行动态状态验证", reason: "当前阶段唯一重点", priority: 10 },
    ],
  });
  assert.equal(card.changes.length, 2);
  assert.equal(card.uncertain_candidates.length, 1);
  assert.equal(card.next_action.text, "运行动态状态验证");
  decideStateUpdate(db, cycleId, "accept", { reason: "Creator accepted." });
  const current = getCurrentState(db, subjectId);
  assert.equal(current.state.current.stage, "dynamic_validation");
  assert.equal(current.state.future.desired_state, "long_term_companion");
  assert.equal(current.state.stable.identity, "AI education creator");
  const history = listStateHistory(db, subjectId);
  assert.equal(history.length, 2);
  assert.equal(history[0].status, "historical");
  assert.equal(history[1].status, "current");
  assert.throws(
    () => db.prepare(`UPDATE state_snapshots SET state_json = '{}' WHERE snapshot_id = ?`).run(history[0].snapshot_id),
    /immutable/,
  );
});

test("questions are capped at three and are not repeated across cycles", () => {
  const signals = Array.from({ length: 5 }, (_, index) => ({
    path: `current.unknown_${index}`,
    operation: "set",
    value: `value_${index}`,
    confidence: "low",
    source_type: "inference",
    question: {
      key: `unknown-${index}`,
      text: `确认信息 ${index}？`,
      why_it_matters: "会影响下一步。",
      priority: 10 - index,
    },
  }));
  const first = proposeStateUpdate(db, subjectId, {
    observed_at: "2026-07-13T10:00:00.000Z",
    signals,
  });
  assert.equal(first.decision_card.questions.length, 3);
  answerStateQuestion(db, subjectId, first.decision_card.questions[0].key, "confirmed");
  decideStateUpdate(db, first.cycle_id, "reject", { reason: "Need better evidence." });
  const second = proposeStateUpdate(db, subjectId, {
    observed_at: "2026-07-13T11:00:00.000Z",
    signals,
  });
  assert.equal(second.decision_card.questions.length, 2);
  const firstKeys = new Set(first.decision_card.questions.map((question) => question.key));
  assert.equal(second.decision_card.questions.some((question) => firstKeys.has(question.key)), false);
});

test("invalidated information remains in history but disappears from current state", () => {
  db.close();
  rmSync(runtime, { recursive: true, force: true });
  db = openStore(join(runtime, "state.sqlite"));
  ({ subject_id: subjectId } = createStateSubject(db, {
    subject_id: "creator",
    display_name: "Creator",
    initial_state: initialState({ current: { old_priority: "project_a" } }),
    source: { type: "creator_explicit", reference: "test baseline" },
  }));
  const proposal = proposeStateUpdate(db, subjectId, {
    observed_at: "2026-07-13T12:00:00.000Z",
    signals: [{
      path: "current.old_priority",
      operation: "invalidate",
      confidence: "high",
      source_type: "verified_evidence",
      reason: "Project A paused.",
    }],
  });
  decideStateUpdate(db, proposal.cycle_id, "accept");
  assert.equal(getCurrentState(db, subjectId).state.current.old_priority, undefined);
  assert.equal(listStateHistory(db, subjectId)[0].state.current.old_priority, "project_a");
});

test("reject keeps current state and creator correction becomes the authoritative snapshot", () => {
  const proposal = proposeStateUpdate(db, subjectId, {
    observed_at: "2026-07-13T13:00:00.000Z",
    signals: [{ path: "current.stage", operation: "set", value: "wrong", confidence: "high", source_type: "verified_evidence" }],
  });
  decideStateUpdate(db, proposal.cycle_id, "reject", { reason: "Incorrect interpretation." });
  assert.equal(getCurrentState(db, subjectId).state.current.stage, "static_profile");
  const correction = proposeStateUpdate(db, subjectId, {
    observed_at: "2026-07-13T14:00:00.000Z",
    signals: [{ path: "current.stage", operation: "set", value: "candidate", confidence: "high", source_type: "verified_evidence" }],
  });
  decideStateUpdate(db, correction.cycle_id, "correct", {
    reason: "Creator supplied the exact stage.",
    corrected_state: initialState({ current: { stage: "dynamic_validation", primary_focus: "higher_ed" } }),
  });
  assert.equal(getCurrentState(db, subjectId).state.current.stage, "dynamic_validation");
  assert.equal(getCurrentState(db, subjectId).source.type, "creator_correction");
});

test("controlled replay evidence cannot change live state", () => {
  const live = proposeStateUpdate(db, subjectId, {
    observed_at: "2026-07-13T15:00:00.000Z",
    signals: [{ path: "current.stage", operation: "set", value: "replay_only", confidence: "high", source_type: "controlled_replay" }],
  });
  assert.equal(live.decision_card.changes.length, 0);
  decideStateUpdate(db, live.cycle_id, "reject");
  const replay = proposeStateUpdate(db, subjectId, {
    observed_at: "2026-07-13T15:01:00.000Z",
    signals: [{ path: "current.stage", operation: "set", value: "replay_only", confidence: "high", source_type: "controlled_replay" }],
  }, { mode: "controlled_replay" });
  assert.equal(replay.decision_card.changes.length, 1);
});

test("a proposal based on a superseded snapshot cannot overwrite newer state", () => {
  const first = proposeStateUpdate(db, subjectId, {
    observed_at: "2026-07-13T15:10:00.000Z",
    signals: [{ path: "current.stage", operation: "set", value: "first", confidence: "high", source_type: "creator_explicit" }],
  });
  const stale = proposeStateUpdate(db, subjectId, {
    observed_at: "2026-07-13T15:11:00.000Z",
    signals: [{ path: "current.stage", operation: "set", value: "stale", confidence: "high", source_type: "creator_explicit" }],
  });
  decideStateUpdate(db, first.cycle_id, "accept");
  assert.throws(() => decideStateUpdate(db, stale.cycle_id, "accept"), /proposal is stale/);
  assert.equal(getCurrentState(db, subjectId).state.current.stage, "first");
});

test("decision card read model stays concise and exposes accept/correct/reject", () => {
  const proposal = proposeStateUpdate(db, subjectId, {
    observed_at: "2026-07-13T16:00:00.000Z",
    signals: [
      {
        path: "current.priority",
        operation: "set",
        value: "needs_confirmation",
        confidence: "low",
        source_type: "inference",
        question: { key: "priority", text: "当前最高优先级是什么？", why_it_matters: "决定唯一下一步。", priority: 10 },
      },
      {
        path: "current.urgent_priorities",
        operation: "set",
        value: ["天枢", "教师课件 PPT"],
        confidence: "high",
        source_type: "creator_explicit",
      },
    ],
  });
  const output = join(runtime, "decision-card.md");
  const card = buildStateDecisionCard(db, proposal.cycle_id);
  renderStateDecisionCardMarkdown(db, proposal.cycle_id, output);
  const markdown = readFileSync(output, "utf8");
  assert.equal(card.summary, "识别到 1 项可更新变化，1 个必要问题。");
  assert.match(markdown, /不代表阶段 B 已通过/);
  assert.match(markdown, /当前最高优先级是什么/);
  assert.match(markdown, /天枢；教师课件 PPT/);
  assert.doesNotMatch(markdown, /0: 天枢/);
  assert.match(markdown, /接受/);
  assert.match(markdown, /纠正/);
  assert.match(markdown, /拒绝/);
  assert.doesNotMatch(markdown, /current\./);
});
