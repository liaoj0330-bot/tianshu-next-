import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  appendEvent,
  canonicalJson,
  getOne,
  newId,
  now,
} from "../core/store.mjs";

const STATE_LAYERS = new Set(["stable", "current", "future"]);
const FORBIDDEN_PATH_PARTS = new Set(["__proto__", "constructor", "prototype"]);
const TRUSTED_CURRENT_SOURCES = new Set(["creator_explicit", "verified_evidence"]);

function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function parseJson(value) {
  return value == null ? null : JSON.parse(value);
}

function clone(value) {
  return structuredClone(value);
}

function validateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("state must be an object");
  }
  const state = {};
  for (const layer of STATE_LAYERS) {
    const candidate = value[layer] ?? {};
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`${layer} state must be an object`);
    }
    state[layer] = clone(candidate);
  }
  return state;
}

function splitPath(path) {
  if (typeof path !== "string" || !path.includes(".")) {
    throw new Error("signal path must include a state layer");
  }
  const parts = path.split(".").filter(Boolean);
  if (!STATE_LAYERS.has(parts[0]) || parts.some((part) => FORBIDDEN_PATH_PARTS.has(part))) {
    throw new Error(`invalid state path: ${path}`);
  }
  return parts;
}

function getPath(root, path) {
  return splitPath(path).reduce((value, part) => value?.[part], root);
}

function setPath(root, path, value) {
  const parts = splitPath(path);
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = clone(value);
}

function deletePath(root, path) {
  const parts = splitPath(path);
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") return;
    cursor = cursor[part];
  }
  delete cursor[parts.at(-1)];
}

function signalCanChangeState(signal, mode) {
  if (signal.confidence !== "high") return false;
  const [layer] = splitPath(signal.path);
  const controlledReplay = mode === "controlled_replay" && signal.source_type === "controlled_replay";
  if (controlledReplay) return true;
  if (layer === "stable" || layer === "future") return signal.source_type === "creator_explicit";
  return TRUSTED_CURRENT_SOURCES.has(signal.source_type);
}

function questionForSignal(signal) {
  if (signal.question) return signal.question;
  return {
    key: `confirm:${signal.path}`,
    text: `是否确认“${signal.path}”发生了变化？`,
    why_it_matters: "确认后才允许改变当前状态。",
    priority: signal.priority ?? 0,
  };
}

function selectNewQuestions(db, subjectId, candidates) {
  const existing = new Set(
    db.prepare(`SELECT question_key FROM state_questions WHERE subject_id = ?`).all(subjectId)
      .map((row) => row.question_key),
  );
  const unique = new Map();
  for (const candidate of candidates) {
    if (!candidate?.key || !candidate?.text || !candidate?.why_it_matters) continue;
    if (existing.has(candidate.key) || unique.has(candidate.key)) continue;
    unique.set(candidate.key, {
      key: candidate.key,
      text: candidate.text,
      why_it_matters: candidate.why_it_matters,
      priority: Number(candidate.priority ?? 0),
    });
  }
  return [...unique.values()]
    .sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key))
    .slice(0, 3);
}

function selectNextAction(actions, questions) {
  const candidates = (actions ?? []).map((action, index) => ({
    text: action.text,
    reason: action.reason ?? "",
    priority: Number(action.priority ?? 0),
    requires_approval: Boolean(action.requires_approval),
    index,
  })).filter((action) => action.text);
  candidates.sort((left, right) => right.priority - left.priority || left.index - right.index);
  if (candidates[0]) {
    const { index, ...selected } = candidates[0];
    return selected;
  }
  if (questions[0]) {
    return {
      text: "先回答当前最高价值问题，再决定是否更新状态。",
      reason: questions[0].why_it_matters,
      priority: 0,
      requires_approval: false,
    };
  }
  return {
    text: "保持当前状态，不执行额外动作。",
    reason: "没有发现足以改变状态的新证据。",
    priority: 0,
    requires_approval: false,
  };
}

function currentSnapshotRow(db, subjectId) {
  return db.prepare(`
    SELECT s.* FROM state_snapshots s
    JOIN state_subjects subject ON subject.current_snapshot_id = s.snapshot_id
    WHERE subject.subject_id = ?
  `).get(subjectId);
}

export function createStateSubject(db, {
  subject_id = newId("subject"),
  display_name,
  initial_state,
  source,
}) {
  if (!display_name || !source?.type) throw new Error("state subject requires display_name and source");
  const state = validateState(initial_state);
  const snapshotId = newId("snapshot");
  const timestamp = now();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO state_subjects(subject_id, display_name, current_snapshot_id, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?)
    `).run(subject_id, display_name, timestamp, timestamp);
    db.prepare(`
      INSERT INTO state_snapshots(
        snapshot_id, subject_id, version, status, state_json, source_json,
        cycle_id, created_at, superseded_at
      ) VALUES (?, ?, 1, 'current', ?, ?, NULL, ?, NULL)
    `).run(snapshotId, subject_id, canonicalJson(state), canonicalJson(source), timestamp);
    db.prepare(`UPDATE state_subjects SET current_snapshot_id = ? WHERE subject_id = ?`)
      .run(snapshotId, subject_id);
    appendEvent(db, "state_subject", subject_id, "state_subject.created", { snapshot_id: snapshotId });
  });
  return { subject_id, snapshot_id: snapshotId };
}

export function proposeStateUpdate(db, subjectId, update, { mode = "live" } = {}) {
  const subject = getOne(db, "state_subjects", "subject_id", subjectId);
  if (!subject) throw new Error("state subject not found");
  if (!update?.observed_at || !Array.isArray(update?.signals)) {
    throw new Error("state update requires observed_at and signals");
  }
  const base = currentSnapshotRow(db, subjectId);
  const currentState = validateState(parseJson(base.state_json));
  const proposedState = clone(currentState);
  const appliedChanges = [];
  const unchangedSignals = [];
  const candidates = [];
  const questionCandidates = [];

  for (const signal of update.signals) {
    splitPath(signal.path);
    if (!signalCanChangeState(signal, mode)) {
      candidates.push({ ...signal, reason: "insufficient_authority_or_confidence" });
      questionCandidates.push(questionForSignal(signal));
      continue;
    }
    const previous = getPath(proposedState, signal.path);
    if (signal.operation === "invalidate") {
      if (previous === undefined) {
        unchangedSignals.push({ path: signal.path, reason: "already_absent" });
        continue;
      }
      deletePath(proposedState, signal.path);
      appliedChanges.push({
        path: signal.path,
        operation: "invalidate",
        previous,
        reason: signal.reason ?? null,
        source_type: signal.source_type,
      });
      continue;
    }
    if (signal.operation !== "set") throw new Error("signal operation must be set or invalidate");
    if (canonicalJson(previous) === canonicalJson(signal.value)) {
      unchangedSignals.push({ path: signal.path, reason: "same_value" });
      continue;
    }
    setPath(proposedState, signal.path, signal.value);
    appliedChanges.push({
      path: signal.path,
      operation: "set",
      previous: previous ?? null,
      next: clone(signal.value),
      source_type: signal.source_type,
    });
  }

  for (const requirement of update.requirements ?? []) {
    if (getPath(proposedState, requirement.path) == null || getPath(proposedState, requirement.path) === "") {
      questionCandidates.push({
        key: requirement.key,
        text: requirement.text,
        why_it_matters: requirement.why_it_matters,
        priority: requirement.priority ?? 0,
      });
    }
  }

  const questions = selectNewQuestions(db, subjectId, questionCandidates);
  const nextAction = selectNextAction(update.candidate_actions, questions);
  const comparison = {
    base_snapshot_id: base.snapshot_id,
    applied_changes: appliedChanges,
    unchanged_signals: unchangedSignals,
    candidates,
    mode,
  };
  const cycleId = newId("state_cycle");
  const timestamp = now();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO state_update_cycles(
        cycle_id, subject_id, base_snapshot_id, observed_at, input_json,
        comparison_json, proposed_state_json, questions_json, next_action_json,
        status, accepted_snapshot_id, decision_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_creator_decision', NULL, NULL, ?, ?)
    `).run(
      cycleId,
      subjectId,
      base.snapshot_id,
      update.observed_at,
      canonicalJson(update),
      canonicalJson(comparison),
      canonicalJson(proposedState),
      canonicalJson(questions),
      canonicalJson(nextAction),
      timestamp,
      timestamp,
    );
    for (const question of questions) {
      db.prepare(`
        INSERT INTO state_questions(
          question_id, subject_id, question_key, question_text, why_it_matters,
          status, answer_json, first_cycle_id, asked_at, answered_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL)
      `).run(
        newId("question"),
        subjectId,
        question.key,
        question.text,
        question.why_it_matters,
        cycleId,
        timestamp,
      );
    }
    appendEvent(db, "state_cycle", cycleId, "state_cycle.proposed", {
      subject_id: subjectId,
      applied_change_count: appliedChanges.length,
      question_count: questions.length,
    });
  });
  return { cycle_id: cycleId, decision_card: buildStateDecisionCard(db, cycleId) };
}

export function decideStateUpdate(db, cycleId, decision, {
  reason = "",
  corrected_state = null,
  decided_by = "creator",
} = {}) {
  if (!new Set(["accept", "correct", "reject"]).has(decision)) {
    throw new Error("invalid state update decision");
  }
  const cycle = getOne(db, "state_update_cycles", "cycle_id", cycleId);
  if (!cycle || cycle.status !== "awaiting_creator_decision") {
    throw new Error("state update cycle is not awaiting creator decision");
  }
  if (decision === "reject") {
    transaction(db, () => {
      db.prepare(`
        UPDATE state_update_cycles
        SET status = 'rejected', decision_reason = ?, updated_at = ?
        WHERE cycle_id = ?
      `).run(reason, now(), cycleId);
      appendEvent(db, "state_cycle", cycleId, "state_cycle.rejected", { decided_by, reason });
    });
    return { cycle_id: cycleId, snapshot_id: null, status: "rejected" };
  }

  const subject = getOne(db, "state_subjects", "subject_id", cycle.subject_id);
  if (subject.current_snapshot_id !== cycle.base_snapshot_id) {
    throw new Error("state update proposal is stale");
  }
  const base = getOne(db, "state_snapshots", "snapshot_id", cycle.base_snapshot_id);
  const nextState = decision === "correct"
    ? validateState(corrected_state)
    : validateState(parseJson(cycle.proposed_state_json));
  const stateChanged = canonicalJson(nextState) !== base.state_json;
  const timestamp = now();
  let snapshotId = base.snapshot_id;

  transaction(db, () => {
    if (stateChanged) {
      snapshotId = newId("snapshot");
      db.prepare(`
        UPDATE state_snapshots SET status = 'historical', superseded_at = ?
        WHERE snapshot_id = ?
      `).run(timestamp, base.snapshot_id);
      db.prepare(`
        INSERT INTO state_snapshots(
          snapshot_id, subject_id, version, status, state_json, source_json,
          cycle_id, created_at, superseded_at
        ) VALUES (?, ?, ?, 'current', ?, ?, ?, ?, NULL)
      `).run(
        snapshotId,
        cycle.subject_id,
        base.version + 1,
        canonicalJson(nextState),
        canonicalJson({ type: decision === "correct" ? "creator_correction" : "accepted_proposal", decided_by }),
        cycleId,
        timestamp,
      );
      db.prepare(`
        UPDATE state_subjects SET current_snapshot_id = ?, updated_at = ? WHERE subject_id = ?
      `).run(snapshotId, timestamp, cycle.subject_id);
    }
    db.prepare(`
      UPDATE state_update_cycles
      SET status = ?, accepted_snapshot_id = ?, decision_reason = ?, updated_at = ?
      WHERE cycle_id = ?
    `).run(decision === "correct" ? "corrected" : "accepted", snapshotId, reason, timestamp, cycleId);
    appendEvent(db, "state_cycle", cycleId, `state_cycle.${decision === "correct" ? "corrected" : "accepted"}`, {
      decided_by,
      snapshot_id: snapshotId,
      state_changed: stateChanged,
    });
  });
  return {
    cycle_id: cycleId,
    snapshot_id: snapshotId,
    status: decision === "correct" ? "corrected" : "accepted",
  };
}

export function answerStateQuestion(db, subjectId, questionKey, answer, answeredBy = "creator") {
  const question = db.prepare(`
    SELECT * FROM state_questions WHERE subject_id = ? AND question_key = ?
  `).get(subjectId, questionKey);
  if (!question || question.status !== "pending") throw new Error("state question is not pending");
  const timestamp = now();
  transaction(db, () => {
    db.prepare(`
      UPDATE state_questions
      SET status = 'answered', answer_json = ?, answered_at = ?
      WHERE question_id = ?
    `).run(canonicalJson({ answer, answered_by: answeredBy }), timestamp, question.question_id);
    appendEvent(db, "state_question", question.question_id, "state_question.answered", {
      subject_id: subjectId,
      question_key: questionKey,
      answered_by: answeredBy,
    });
  });
}

export function getCurrentState(db, subjectId) {
  const snapshot = currentSnapshotRow(db, subjectId);
  if (!snapshot) return null;
  return {
    snapshot_id: snapshot.snapshot_id,
    version: snapshot.version,
    state: validateState(parseJson(snapshot.state_json)),
    source: parseJson(snapshot.source_json),
    created_at: snapshot.created_at,
  };
}

export function listStateHistory(db, subjectId) {
  return db.prepare(`
    SELECT * FROM state_snapshots WHERE subject_id = ? ORDER BY version
  `).all(subjectId).map((snapshot) => ({
    snapshot_id: snapshot.snapshot_id,
    version: snapshot.version,
    status: snapshot.status,
    state: parseJson(snapshot.state_json),
    source: parseJson(snapshot.source_json),
    cycle_id: snapshot.cycle_id,
    created_at: snapshot.created_at,
    superseded_at: snapshot.superseded_at,
  }));
}

export function buildStateDecisionCard(db, cycleId) {
  const cycle = getOne(db, "state_update_cycles", "cycle_id", cycleId);
  if (!cycle) throw new Error("state update cycle not found");
  const comparison = parseJson(cycle.comparison_json);
  const questions = parseJson(cycle.questions_json);
  return {
    cycle_id: cycle.cycle_id,
    subject_id: cycle.subject_id,
    status: cycle.status,
    observed_at: cycle.observed_at,
    summary: `识别到 ${comparison.applied_changes.length} 项可更新变化，${questions.length} 个必要问题。`,
    changes: comparison.applied_changes,
    uncertain_candidates: comparison.candidates,
    questions,
    next_action: parseJson(cycle.next_action_json),
    creator_options: ["accept", "correct", "reject"],
    product_acceptance: false,
  };
}

const FIELD_LABELS = {
  "current.engineering_stage": "工程状态",
  "current.dynamic_state_mvp.tests": "自动测试",
  "current.dynamic_state_mvp.controlled_replay": "受控回放",
  "current.git_baseline_commit": "本地 Git 基线",
  "current.component_role_commit": "组件职责边界",
  "current.primary_focus": "当前唯一重点",
  "current.higher_education.status": "高校板块当前状态",
  "current.higher_education.material_plan": "高校资料安排",
  "current.higher_education.resume_window": "高校预计恢复时间",
  "current.urgent_priorities": "当前要紧事项",
  "current.execution_mode": "推进方式",
  "current.priority_rule": "冲突时的优先规则",
  "current.teacher_ppt.stage": "教师课件 PPT 当前阶段",
  "current.teacher_ppt.backend_evidence": "教师课件 PPT 后端证据",
  "current.teacher_ppt.remaining_gate": "069 退出前剩余验收",
  "current.teacher_ppt.next_stage": "教师课件 PPT 下一阶段",
  "current.product_stage": "产品阶段",
  "current.real_validation_cycles_completed": "接受后累计真实验证轮次",
};

const VALUE_LABELS = {
  dynamic_state_mvp_engineering_validated: "动态状态闭环 MVP 已通过工程验证",
  creator_review_real_validation_cycle_1: "审阅第 1 轮真实状态更新",
  stage_b_validation: "阶段 B 验证中",
};

function humanField(path) {
  return FIELD_LABELS[path] ?? path.split(".").at(-1).replaceAll("_", " ");
}

function humanValue(path, value) {
  if (VALUE_LABELS[value]) return VALUE_LABELS[value];
  if (path === "current.dynamic_state_mvp.tests") {
    return `${value.passed}/${value.total} 项通过`;
  }
  if (path === "current.dynamic_state_mvp.controlled_replay") {
    return `${value.cycles} 轮完成，重复问题 ${value.repeated_questions} 个，形成 ${value.snapshot_count} 个快照；不计入阶段 B 通过`;
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join("；");
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join("；");
  }
  return String(value);
}

export function renderStateDecisionCardMarkdown(db, cycleId, outputPath) {
  const card = buildStateDecisionCard(db, cycleId);
  const changes = card.changes.length
    ? card.changes.map((change) => `- **${humanField(change.path)}：** ${change.operation === "invalidate" ? "标记失效" : humanValue(change.path, change.next)}`).join("\n")
    : "- 没有足够证据支持直接更新当前状态。";
  const questions = card.questions.length
    ? card.questions.map((question, index) => `${index + 1}. ${question.text}`).join("\n")
    : "本轮没有必要追问。";
  const content = `# 动态状态更新决策卡\n\n` +
    `> 本卡是隔离 MVP 读模型，不代表阶段 B 已通过，也不会自动写入正式 Vault。\n\n` +
    `## 当前结论\n\n${card.summary}\n\n` +
    `## 建议更新\n\n${changes}\n\n` +
    `## 需要确认\n\n${questions}\n\n` +
    `## 唯一下一步\n\n${card.next_action.text}\n\n` +
    `原因：${card.next_action.reason}\n\n` +
    `## 奈奈决策\n\n- 接受\n- 纠正\n- 拒绝\n`;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
  return outputPath;
}
