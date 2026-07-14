import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";

const runtime = resolve(".project-changes-gateway-test-runtime");
let gateway, db;
afterEach(async () => { await gateway?.close(); db?.close(); rmSync(runtime, { recursive: true, force: true }); });
async function request(base, path, init = {}) {
  const response = await fetch(base + path, { headers: { "content-type": "application/json" }, ...init });
  return { status: response.status, body: await response.json() };
}
async function setup() {
  db = openStore(join(runtime, "state.sqlite"));
  gateway = createGateway({ db });
  const address = await gateway.listen();
  const base = "http://" + address.address + ":" + address.port;
  await request(base, "/v1/creator/portfolio/import", { method: "POST", body: JSON.stringify({
    source: { kind: "formal_creator_model", reference: "test", version: "1" },
    projects: [
      { project_key: "tianshu", display_name: "天枢", lane: "main", baseline_priority: 5, execution_policy: "eligible_after_approval", status: "active" },
      { project_key: "protected", display_name: "受保护项目", lane: "protected", baseline_priority: 1, execution_policy: "no_access", status: "protected" }
    ]
  }) });
  return base;
}

test("project update stays a candidate until creator accepts, then updates SQLite state and Today visualization", async () => {
  const base = await setup();
  const proposed = await request(base, "/v1/creator/projects/tianshu/changes", { method: "POST", body: JSON.stringify({
    change_type: "stage",
    summary: "真实隔离任务进入验收阶段",
    proposed_value: "acceptance",
    impact: ["今天优先完成最终验收", "尚不代表项目完成"],
    source: { kind: "creator_update", reference: "conversation-20260715" },
    evidence: [{ kind: "run", reference: "run-test" }],
    confidence: "high"
  }) });
  assert.equal(proposed.status, 201);
  assert.equal(proposed.body.change.status, "awaiting_creator_confirmation");

  const before = await request(base, "/v1/creator/projects/tianshu/state");
  assert.deepEqual(before.body.state, {});
  const todayBefore = await request(base, "/v1/today");
  const pending = todayBefore.body.confirmations.find((item) => item.type === "project_change");
  assert.equal(pending.result.interaction.project_change_candidate.proposed_value, "acceptance");
  assert.equal(todayBefore.body.project_timeline[0].status, "awaiting_creator_confirmation");

  const accepted = await request(base, "/v1/project-changes/" + proposed.body.change.change_id + "/decision", { method: "POST", body: JSON.stringify({ decision: "accept", decided_by: "creator", reason: "事实正确" }) });
  assert.equal(accepted.body.change.status, "accepted");
  const after = await request(base, "/v1/creator/projects/tianshu/state");
  assert.equal(after.body.state.stage.value, "acceptance");
  const todayAfter = await request(base, "/v1/today");
  assert.equal(todayAfter.body.confirmations.some((item) => item.confirmation_id === proposed.body.change.change_id), false);
  assert.equal(todayAfter.body.projects[0].current_state.stage.value, "acceptance");
  assert.equal(todayAfter.body.project_timeline[0].status, "accepted");

  const incremental = await request(base, "/v1/project-changes?after_id=0&project_key=tianshu");
  assert.equal(incremental.body.items.length, 1);
  assert.ok(incremental.body.items[0].cursor > 0);
});

test("conflicting changes are visible, exact duplicates are deduplicated, and creator acceptance resolves the conflict", async () => {
  const base = await setup();
  const payload = (value, reference) => JSON.stringify({
    change_type: "risk", summary: "风险判断 " + value, proposed_value: value,
    source: { kind: "creator_update", reference }, confidence: "high"
  });
  const first = await request(base, "/v1/creator/projects/tianshu/changes", { method: "POST", body: payload("high", "risk-1") });
  const duplicate = await request(base, "/v1/creator/projects/tianshu/changes", { method: "POST", body: payload("high", "risk-duplicate") });
  assert.equal(duplicate.body.change.change_id, first.body.change.change_id);
  assert.equal(duplicate.body.change.deduplicated, true);
  const second = await request(base, "/v1/creator/projects/tianshu/changes", { method: "POST", body: payload("low", "risk-2") });
  assert.equal(second.body.change.conflicts.length, 1);

  const today = await request(base, "/v1/today");
  assert.equal(today.body.attention_summary[0].conflicts, 1);
  assert.equal(today.body.attention_summary[0].strategic_priority_unchanged, true);
  assert.ok(today.body.confirmations.some((item) => item.type === "project_change" && item.result.interaction.project_change_candidate.conflict_count === 1));

  await request(base, "/v1/project-changes/" + second.body.change.change_id + "/decision", { method: "POST", body: JSON.stringify({ decision: "accept", decided_by: "creator", reason: "采用最新判断" }) });
  const rows = await request(base, "/v1/project-changes?project_key=tianshu");
  const old = rows.body.items.find((item) => item.change_id === first.body.change.change_id);
  assert.equal(old.status, "superseded");
  const state = await request(base, "/v1/creator/projects/tianshu/state");
  assert.equal(state.body.state.risk.value, "low");
});
test("protected projects reject change ingestion", async () => {
  const base = await setup();
  const result = await request(base, "/v1/creator/projects/protected/changes", { method: "POST", body: JSON.stringify({
    change_type: "note", summary: "不应写入", proposed_value: "blocked",
    source: { kind: "test", reference: "protected" }
  }) });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /protected project/);
});