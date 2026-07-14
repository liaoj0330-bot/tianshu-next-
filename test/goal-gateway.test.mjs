import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";

test("gateway turns natural language into an immutable goal contract", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-goal-gateway-"));
  const db = openStore(join(root, "state.sqlite")); const gateway = createGateway({ db }); const address = await gateway.listen();
  try {
    const response = await fetch(`http://${address.address}:${address.port}/v1/goals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ original_request: "推进高校 AI 教育项目", success_criteria: ["形成下一步计划"] }) });
    const result = await response.json();
    assert.equal(response.status, 201); assert.match(result.goal_id, /^goal_/); assert.equal(result.status, "proposed");
    assert.equal(result.contract.operating_domain, "work");
  } finally { await gateway.close(); db.close(); }
});
