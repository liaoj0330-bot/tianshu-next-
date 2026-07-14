import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openStore } from "../src/core/store.mjs";
import { registerAgent } from "../src/agents/registry.mjs";
import { prepareManagedTask, dispatchManagedAgentTask } from "../src/orchestration/pipeline.mjs";

test("real dispatcher output is attached to a managed run", async () => {
  const db = openStore(join(mkdtempSync(join(tmpdir(), "tianshu-managed-agent-")), "state.sqlite"));
  registerAgent(db, { agent_id: "node-managed", display_name: "Node managed", command: process.execPath, args: ["-e", "console.log(process.argv[1])", "--", "__PROMPT__"], capabilities: ["text_task"], risk_level: "L0" });
  const prepared = prepareManagedTask(db, { contract: { objective: "run agent", completion_criteria: ["return output"] }, plan: { action: "text", allowed_paths: [] }, riskLevel: "L0", autoApprove: true });
  const result = await dispatchManagedAgentTask(db, { taskId: prepared.taskId, agentId: "node-managed", prompt: "READY-MANAGED" });
  assert.match(result.runId, /^run_/); assert.equal(result.executor.status, "succeeded");
  assert.equal(db.prepare("SELECT status FROM runs WHERE run_id=?").get(result.runId).status, "awaiting_verification");
  db.close();
});
