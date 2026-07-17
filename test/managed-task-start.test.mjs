import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/core/store.mjs";
import { createGoal, decideApproval, getPlanHash, proposePlan } from "../src/core/kernel.mjs";
import { configureExecutionBoundary, createExecutionBoundary, decideExecutionBoundary } from "../src/planning/execution-boundary.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import { registerAgent } from "../src/agents/registry.mjs";
import { executeManagedTaskJob } from "../src/orchestration/managed-job.mjs";

test("approved task start is durable and idempotent", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-start-"));
  const db = openStore(":memory:");
  const goalId = createGoal(db, { objective: "verify start", completion_criteria: ["job queued"] });
  const planId = proposePlan(db, goalId, { action: "verify start", allowed_paths: [root] });
  createExecutionBoundary(db, planId);
  configureExecutionBoundary(db, planId, { executor_agent: "executor", verifier_agent: "verifier", allowed_paths: [root], timeout_ms: 5000, max_attempts: 2 }, { workspace_root: root });
  decideExecutionBoundary(db, planId, "approve");
  const { taskId } = decideApproval(db, planId, "approved", getPlanHash(db, planId));
  const gateway = createGateway({ db, host: "127.0.0.1", port: 0 });
  const address = await gateway.listen();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const first = await fetch(`${base}/v1/tasks/${taskId}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decided_by: "nainai" }) });
    const firstBody = await first.json();
    assert.equal(first.status, 202);
    assert.equal(firstBody.status, "queued");
    const replay = await fetch(`${base}/v1/tasks/${taskId}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decided_by: "nainai" }) });
    const replayBody = await replay.json();
    assert.equal(replayBody.job_id, firstBody.job_id);
    assert.equal(replayBody.replayed, true);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM jobs").get().count, 1);
  } finally {
    await gateway.close();
    db.close();
  }
});

test("managed execution runs executor then a different structured verifier", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-managed-"));
  const db = openStore(":memory:");
  registerAgent(db, { agent_id: "executor", display_name: "Executor", command: process.execPath, args: ["-e", "console.log('executor evidence')"], capabilities: ["text_task"], risk_level: "L0" });
  registerAgent(db, { agent_id: "verifier", display_name: "Verifier", command: process.execPath, args: ["-e", "console.log(JSON.stringify({verdict:'pass',checks:[{name:'evidence',passed:true,evidence:'executor evidence inspected'}]}))"], capabilities: ["text_task"], risk_level: "L0" });
  const goalId = createGoal(db, { objective: "produce evidence", completion_criteria: ["evidence exists"] });
  const planId = proposePlan(db, goalId, { action: "produce evidence", allowed_paths: [root] });
  createExecutionBoundary(db, planId);
  configureExecutionBoundary(db, planId, { executor_agent: "executor", verifier_agent: "verifier", allowed_paths: [root], timeout_ms: 5000, max_attempts: 1 }, { workspace_root: root });
  decideExecutionBoundary(db, planId, "approve");
  const { taskId } = decideApproval(db, planId, "approved", getPlanHash(db, planId));
  const outcome = await executeManagedTaskJob({ db, job: null, payload: { task_id: taskId } });
  assert.equal(outcome.task_id, taskId);
  assert.equal(outcome.verification.passed, true);
  assert.equal(db.prepare("SELECT status FROM tasks WHERE task_id=?").get(taskId).status, "awaiting_creator_decision");
  assert.equal(db.prepare("SELECT verifier FROM verifications WHERE run_id=?").get(outcome.run_id).verifier, "agent:verifier");
  db.close();
});
