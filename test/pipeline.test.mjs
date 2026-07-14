import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openStore } from "../src/core/store.mjs";
import { prepareManagedTask, recordManagedExecution } from "../src/orchestration/pipeline.mjs";

test("managed pipeline keeps goal, plan, run, verification, and decision linked", () => {
  const db = openStore(join(mkdtempSync(join(tmpdir(), "tianshu-pipeline-")), "state.sqlite"));
  const prepared = prepareManagedTask(db, {
    contract: { objective: "完成只读诊断", completion_criteria: ["有报告"], operating_domain: "work" },
    plan: { action: "scan", allowed_paths: ["sandbox"], evidence: ["report"] },
    riskLevel: "L0", autoApprove: true,
  });
  assert.match(prepared.goalId, /^goal_/); assert.match(prepared.taskId, /^task_/);
  const finished = recordManagedExecution(db, prepared.taskId, { claim: "finished" }, { passed: true, report: { tests: "ok" } }, { decision: "accept", reason: "evidence passed" });
  assert.match(finished.runId, /^run_/); assert.match(finished.decisionId, /^decision_/);
  assert.equal(db.prepare("SELECT status FROM goals WHERE goal_id=?").get(prepared.goalId).status, "completed");
  db.close();
});
