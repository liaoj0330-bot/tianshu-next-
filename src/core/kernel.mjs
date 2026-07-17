import {
  appendEvent,
  canonicalJson,
  getOne,
  newId,
  now,
  sha256,
} from "./store.mjs";
import { assertAuthority } from "../governance/authority.mjs";

const RUN_TRANSITIONS = {
  running: ["awaiting_verification", "recovery_required"],
  awaiting_verification: ["verification_passed", "verification_failed"],
  verification_passed: ["accepted", "rejected"],
  verification_failed: ["rejected"],
  recovery_required: ["rejected"],
};

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

function requireStatus(entity, expected, label) {
  if (!entity || !expected.includes(entity.status)) {
    throw new Error(`${label} must be in ${expected.join(" or ")}`);
  }
}

function transitionRun(db, run, nextStatus, payload = {}) {
  const allowed = RUN_TRANSITIONS[run.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`illegal run transition: ${run.status} -> ${nextStatus}`);
  }
  db.prepare(`UPDATE runs SET status = ?, updated_at = ? WHERE run_id = ?`)
    .run(nextStatus, now(), run.run_id);
  appendEvent(db, "run", run.run_id, `run.${nextStatus}`, payload);
}

export function createGoal(db, contract) {
  if (!contract?.objective || !contract?.completion_criteria) {
    throw new Error("goal contract requires objective and completion_criteria");
  }
  const contractJson = canonicalJson(contract);
  const goalId = newId("goal");
  const timestamp = now();
  transaction(db, () => {
    db.prepare(`INSERT INTO goals VALUES (?, ?, ?, ?, ?, ?)`)
      .run(goalId, contractJson, sha256(contractJson), "contracted", timestamp, timestamp);
    appendEvent(db, "goal", goalId, "goal.contracted", { contract_hash: sha256(contractJson) });
  });
  return goalId;
}

export function proposePlan(db, goalId, specification, riskLevel = "L1") {
  const goal = getOne(db, "goals", "goal_id", goalId);
  requireStatus(goal, ["contracted"], "goal");
  if (!specification?.action || !Array.isArray(specification?.allowed_paths)) {
    throw new Error("plan requires action and allowed_paths");
  }
  const planJson = canonicalJson(specification);
  const planId = newId("plan");
  const timestamp = now();
  transaction(db, () => {
    db.prepare(`INSERT INTO plans VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(planId, goalId, planJson, sha256(planJson), riskLevel, "awaiting_approval", timestamp, timestamp);
    appendEvent(db, "plan", planId, "plan.proposed", { plan_hash: sha256(planJson), risk_level: riskLevel });
  });
  return planId;
}

export function decideApproval(db, planId, decision, suppliedPlanHash, decidedBy = "creator") {
  if (!["approved", "rejected"].includes(decision)) throw new Error("invalid approval decision");
  const actor = assertAuthority(db, decidedBy, "execution.approve");
  const plan = getOne(db, "plans", "plan_id", planId);
  requireStatus(plan, ["awaiting_approval"], "plan");
  if (plan.plan_hash !== suppliedPlanHash) throw new Error("approval plan hash mismatch");
  const approvalId = newId("approval");
  const taskId = decision === "approved" ? newId("task") : null;
  const timestamp = now();
  transaction(db, () => {
    db.prepare(`INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?)`)
      .run(approvalId, planId, plan.plan_hash, decision, actor, timestamp);
    db.prepare(`UPDATE plans SET status = ?, updated_at = ? WHERE plan_id = ?`)
      .run(decision, timestamp, planId);
    appendEvent(db, "approval", approvalId, `approval.${decision}`, { bound_plan_hash: plan.plan_hash });
    if (taskId) {
      db.prepare(`INSERT INTO tasks VALUES (?, ?, ?, ?, ?)`)
        .run(taskId, planId, "approved", timestamp, timestamp);
      appendEvent(db, "task", taskId, "task.created", { plan_id: planId });
    }
  });
  return { approvalId, taskId };
}

export function startRun(db, taskId) {
  const task = getOne(db, "tasks", "task_id", taskId);
  requireStatus(task, ["approved"], "task");
  const plan = getOne(db, "plans", "plan_id", task.plan_id);
  const goal = getOne(db, "goals", "goal_id", plan.goal_id);
  const attempt = db.prepare(`SELECT COUNT(*) AS count FROM runs WHERE task_id = ?`).get(taskId).count + 1;
  const runId = newId("run");
  const timestamp = now();
  transaction(db, () => {
    db.prepare(`INSERT INTO runs VALUES (?, ?, ?, ?, NULL, ?, ?)`)
      .run(runId, taskId, attempt, "running", timestamp, timestamp);
    db.prepare(`UPDATE tasks SET status = 'running', updated_at = ? WHERE task_id = ?`)
      .run(timestamp, taskId);
    db.prepare(`UPDATE goals SET status = 'executing', updated_at = ? WHERE goal_id = ?`)
      .run(timestamp, goal.goal_id);
    appendEvent(db, "run", runId, "run.started", { attempt });
  });
  return runId;
}

export function recordExecutorResult(db, runId, result) {
  const run = getOne(db, "runs", "run_id", runId);
  requireStatus(run, ["running"], "run");
  transaction(db, () => {
    db.prepare(`UPDATE runs SET executor_result_json = ? WHERE run_id = ?`)
      .run(canonicalJson(result), runId);
    transitionRun(db, run, "awaiting_verification", { executor_claim: result.claim ?? null });
    db.prepare(`UPDATE tasks SET status = 'awaiting_verification', updated_at = ? WHERE task_id = ?`)
      .run(now(), run.task_id);
  });
}

export function verifyRun(db, runId, passed, report, verifier = "independent_verifier") {
  if (verifier === "executor") throw new Error("executor cannot verify its own run");
  const run = getOne(db, "runs", "run_id", runId);
  requireStatus(run, ["awaiting_verification"], "run");
  const task = getOne(db, "tasks", "task_id", run.task_id);
  const plan = getOne(db, "plans", "plan_id", task.plan_id);
  const goal = getOne(db, "goals", "goal_id", plan.goal_id);
  const verificationId = newId("verification");
  const nextStatus = passed ? "verification_passed" : "verification_failed";
  const timestamp = now();
  transaction(db, () => {
    db.prepare(`INSERT INTO verifications VALUES (?, ?, ?, ?, ?, ?)`)
      .run(verificationId, runId, passed ? 1 : 0, canonicalJson(report), verifier, timestamp);
    transitionRun(db, run, nextStatus, { verification_id: verificationId, verifier });
    db.prepare(`UPDATE tasks SET status = 'awaiting_creator_decision', updated_at = ? WHERE task_id = ?`)
      .run(timestamp, task.task_id);
    db.prepare(`UPDATE goals SET status = 'awaiting_creator_decision', updated_at = ? WHERE goal_id = ?`)
      .run(timestamp, goal.goal_id);
  });
  return verificationId;
}

export function decideRun(db, runId, decision, reason, decidedBy = "creator") {
  if (!["accept", "reject"].includes(decision)) throw new Error("invalid creator decision");
  const actor = assertAuthority(db, decidedBy, "goal.final_accept");
  const run = getOne(db, "runs", "run_id", runId);
  const task = getOne(db, "tasks", "task_id", run.task_id);
  const plan = getOne(db, "plans", "plan_id", task.plan_id);
  const goal = getOne(db, "goals", "goal_id", plan.goal_id);
  if (decision === "accept" && run.status !== "verification_passed") {
    throw new Error("only an independently verified run can be accepted");
  }
  requireStatus(run, ["verification_passed", "verification_failed", "recovery_required"], "run");
  const decisionId = newId("decision");
  const finalRunStatus = decision === "accept" ? "accepted" : "rejected";
  const finalGoalStatus = decision === "accept" ? "completed" : "rejected";
  const timestamp = now();
  transaction(db, () => {
    db.prepare(`INSERT INTO decisions VALUES (?, ?, ?, ?, ?, ?)`)
      .run(decisionId, runId, decision, reason, actor, timestamp);
    transitionRun(db, run, finalRunStatus, { decision_id: decisionId, decided_by: actor });
    db.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?`)
      .run(finalGoalStatus, timestamp, task.task_id);
    db.prepare(`UPDATE goals SET status = ?, updated_at = ? WHERE goal_id = ?`)
      .run(finalGoalStatus, timestamp, goal.goal_id);
  });
  return decisionId;
}

export function reconcileInterruptedRuns(db) {
  const runs = db.prepare(`SELECT * FROM runs WHERE status = 'running'`).all();
  for (const run of runs) {
    const task = getOne(db, "tasks", "task_id", run.task_id);
    const plan = getOne(db, "plans", "plan_id", task.plan_id);
    transaction(db, () => {
      transitionRun(db, run, "recovery_required", { reason: "process_restart" });
      db.prepare(`UPDATE tasks SET status = 'recovery_required', updated_at = ? WHERE task_id = ?`)
        .run(now(), task.task_id);
      db.prepare(`UPDATE goals SET status = 'recovery_required', updated_at = ? WHERE goal_id = ?`)
        .run(now(), plan.goal_id);
    });
  }
  return runs.map((run) => run.run_id);
}

export function getPlanHash(db, planId) {
  return getOne(db, "plans", "plan_id", planId).plan_hash;
}
