import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, test } from "node:test";
import {
  createGoal,
  decideApproval,
  decideRun,
  getPlanHash,
  proposePlan,
  reconcileInterruptedRuns,
  recordExecutorResult,
  startRun,
  verifyRun,
} from "../src/core/kernel.mjs";
import { getOne, openStore } from "../src/core/store.mjs";

const runtime = resolve(".test-runtime");
let db;

beforeEach(() => {
  db?.close();
  rmSync(runtime, { recursive: true, force: true });
  db = openStore(resolve(runtime, "kernel.sqlite"));
});

function approvedTask() {
  const goalId = createGoal(db, {
    objective: "Produce one independently verified candidate.",
    completion_criteria: ["expected content", "no extra paths", "creator accepts"],
  });
  const planId = proposePlan(db, goalId, {
    action: "edit_fixture",
    allowed_paths: ["fixture.txt"],
    expected_text: "verified",
  });
  const { taskId } = decideApproval(db, planId, "approved", getPlanHash(db, planId));
  return { goalId, planId, taskId };
}

test("goal contracts, plan specifications, and events are immutable", () => {
  const { goalId, planId } = approvedTask();
  assert.throws(
    () => db.prepare(`UPDATE goals SET contract_json = '{}' WHERE goal_id = ?`).run(goalId),
    /immutable/,
  );
  assert.throws(
    () => db.prepare(`UPDATE plans SET plan_json = '{}' WHERE plan_id = ?`).run(planId),
    /immutable/,
  );
  assert.throws(() => db.prepare(`DELETE FROM events`).run(), /append-only/);
});

test("approval is rejected when the plan hash does not match", () => {
  const goalId = createGoal(db, {
    objective: "Hash-bound approval",
    completion_criteria: ["approved exact plan"],
  });
  const planId = proposePlan(db, goalId, { action: "noop", allowed_paths: [] });
  assert.throws(() => decideApproval(db, planId, "approved", "wrong-hash"), /hash mismatch/);
  assert.equal(getOne(db, "plans", "plan_id", planId).status, "awaiting_approval");
});

test("executor output cannot complete a goal without independent verification and creator acceptance", () => {
  const { goalId, taskId } = approvedTask();
  const runId = startRun(db, taskId);
  recordExecutorResult(db, runId, { exit_code: 0, claim: "done" });
  assert.equal(getOne(db, "goals", "goal_id", goalId).status, "executing");
  assert.throws(() => verifyRun(db, runId, true, {}, "executor"), /cannot verify/);
  verifyRun(db, runId, true, { content_matches: true, extra_paths: [] });
  assert.equal(getOne(db, "goals", "goal_id", goalId).status, "awaiting_creator_decision");
  decideRun(db, runId, "accept", "Evidence satisfies the contract.");
  assert.equal(getOne(db, "goals", "goal_id", goalId).status, "completed");
});

test("failed verification cannot be accepted", () => {
  const { goalId, taskId } = approvedTask();
  const runId = startRun(db, taskId);
  recordExecutorResult(db, runId, { exit_code: 0, claim: "done" });
  verifyRun(db, runId, false, { unexpected_paths: ["outside.txt"] });
  assert.throws(() => decideRun(db, runId, "accept", "ignore failure"), /only an independently verified/);
  decideRun(db, runId, "reject", "Scope violation.");
  assert.equal(getOne(db, "goals", "goal_id", goalId).status, "rejected");
});

test("restart reconciliation preserves interrupted runs for explicit recovery", () => {
  const { goalId, taskId } = approvedTask();
  const runId = startRun(db, taskId);
  db.close();
  db = openStore(resolve(runtime, "kernel.sqlite"));
  assert.deepEqual(reconcileInterruptedRuns(db), [runId]);
  assert.equal(getOne(db, "runs", "run_id", runId).status, "recovery_required");
  assert.equal(getOne(db, "goals", "goal_id", goalId).status, "recovery_required");
});
