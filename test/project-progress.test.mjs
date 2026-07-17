import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { upsertCreatorProjectBaseline } from "../src/creator/project-priority.mjs";
import { decideProjectChange } from "../src/creator/project-changes.mjs";
import { getProjectProgressReadModel, normalizeProjectProgress, proposeProjectProgress } from "../src/creator/project-progress.mjs";
import { createGateway } from "../src/gateway/server.mjs";

const runtime = resolve(".project-progress-test-runtime");
let db, gateway;
afterEach(async () => { await gateway?.close(); db?.close(); rmSync(runtime, { recursive: true, force: true }); db = null; gateway = null; });

function setup() {
  db = openStore(join(runtime, "state.sqlite"));
  upsertCreatorProjectBaseline(db, {
    source: { kind: "test", reference: "progress", version: "1" },
    projects: [{ project_key: "demo", display_name: "演示项目", lane: "incubation", baseline_priority: 2, execution_policy: "eligible_after_approval", status: "waiting" }],
  });
}

const update = () => ({
  status: "in_progress",
  stage: "第一轮核验",
  basis: { kind: "milestones", completed: 1, total: 4, description: "四个可验收里程碑" },
  milestones: [{ id: "m1", title: "材料登记", status: "completed" }, { id: "m2", title: "证据分类", status: "in_progress" }],
  current_outcome: "材料已经进入正式记录",
  next_action: "完成证据分类",
  blockers: [],
  source: { kind: "agent_report", reference: "agent-run-progress-1" },
  evidence: [{ kind: "run", reference: "agent-run-1" }],
  confidence: "medium",
});

test("progress is calculated from milestones and remains pending until creator confirmation", () => {
  setup();
  const candidate = proposeProjectProgress(db, "demo", update());
  assert.equal(candidate.status, "awaiting_creator_confirmation");
  assert.equal(candidate.proposed_value.schema_version, 1);
  assert.equal(candidate.proposed_value.percent_complete, 25);
  assert.equal(getProjectProgressReadModel(db, "demo").current, null);
  assert.equal(getProjectProgressReadModel(db, "demo").pending.value.percent_complete, 25);
  decideProjectChange(db, candidate.change_id, { decision: "accept", decided_by: "creator", reason: "核对过证据" });
  const current = getProjectProgressReadModel(db, "demo");
  assert.equal(current.current.percent_complete, 25);
  assert.equal(current.current.status, "in_progress");
  assert.equal(current.pending, null);
});

test("invalid progress cannot claim completion without complete evidence basis", () => {
  assert.throws(() => normalizeProjectProgress({ status: "completed", stage: "完成", basis: { kind: "manual_estimate", percent: 70, description: "估算" }, next_action: "" }), /completed progress must be 100/);
  assert.throws(() => normalizeProjectProgress({ status: "blocked", stage: "卡住", basis: { kind: "milestones", completed: 1, total: 2, description: "里程碑" }, next_action: "找到阻塞原因" }), /blocked progress requires/);
});

test("gateway exposes a single progress reporting path and marks creator confirmation", async () => {
  setup();
  gateway = createGateway({ db });
  const address = await gateway.listen();
  const base = `http://${address.address}:${address.port}`;
  const response = await fetch(base + "/v1/creator/projects/demo/progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(update()) });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.requires_creator_confirmation, true);
  assert.equal(payload.progress.proposed_value.percent_complete, 25);
  const read = await fetch(base + "/v1/creator/projects/demo/progress").then((res) => res.json());
  assert.equal(read.progress.pending.value.percent_complete, 25);
});
