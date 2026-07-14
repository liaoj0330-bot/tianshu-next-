import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import { prepareManagedTask, recordManagedExecution } from "../src/orchestration/pipeline.mjs";

test("gateway exposes a compact decision read model", async () => {
  const db = openStore(join(mkdtempSync(join(tmpdir(), "tianshu-decision-")), "state.sqlite")); const gateway = createGateway({ db }); const address = await gateway.listen();
  try {
    const prepared = prepareManagedTask(db, { contract: { objective: "decision test", completion_criteria: ["verified"] }, plan: { action: "read", allowed_paths: [] }, riskLevel: "L0", autoApprove: true });
    const finished = recordManagedExecution(db, prepared.taskId, { claim: "done" }, { passed: true, report: { evidence: ["ok"] } }, { decision: "accept", reason: "verified" });
    const response = await fetch(`http://${address.address}:${address.port}/v1/runs/${finished.runId}`);
    const model = await response.json();
    assert.equal(model.run.status, "accepted"); assert.equal(model.verification.passed, 1); assert.equal(model.decision.decision, "accept");
    const decisions = await fetch(`http://${address.address}:${address.port}/v1/decisions`).then((r) => r.json());
    assert.equal(decisions.items.length, 1);
  } finally { await gateway.close(); db.close(); }
});
