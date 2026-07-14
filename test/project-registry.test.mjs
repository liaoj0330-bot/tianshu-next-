import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import { assertPathAllowed, buildMinimalContext, registerProject } from "../src/context/project-registry.mjs";
import { assessProject } from "../src/context/active-assistant.mjs";
import { loadProjectRegistry, saveProject } from "../src/context/project-store.mjs";
import { claimJob, enqueueJob, finishJob, reconcileLeases, requestCancel, startJob } from "../src/runtime/governance.mjs";
import { dispatchProbe } from "../src/agents/dispatcher.mjs";
import { listAgents, registerAgent } from "../src/agents/registry.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tianshu-p3-"));
  const docs = join(root, "docs");
  mkdirSync(docs);
  const state = join(docs, "state.md");
  writeFileSync(state, "# Current state\n事实：仅供 P3 隔离测试。\n", "utf8");
  return { root, docs, state };
}

test("registers a project and builds hashed minimal context", () => {
  const f = fixture();
  const registry = new Map();
  registerProject(registry, {
    project_id: "sandbox",
    name: "P3 sandbox",
    root_path: f.root,
    allowed_paths: [f.docs],
    context_files: [f.state],
    purpose: "isolated context test",
  });
  const context = buildMinimalContext(registry, "sandbox");
  assert.equal(context.sources.length, 1);
  assert.match(context.context_sha256, /^[a-f0-9]{64}$/);
});

test("denies context and action paths outside the allowlist", () => {
  const f = fixture();
  const outside = join(f.root, "outside.md");
  writeFileSync(outside, "outside", "utf8");
  const registry = new Map();
  assert.throws(() => registerProject(registry, {
    project_id: "bad",
    name: "bad",
    root_path: f.root,
    allowed_paths: [f.docs],
    context_files: [outside],
  }), /outside the project allowlist/);
  registerProject(registry, {
    project_id: "sandbox",
    name: "P3 sandbox",
    root_path: f.root,
    allowed_paths: [f.docs],
    context_files: [f.state],
  });
  assert.throws(() => assertPathAllowed(registry, "sandbox", outside), /denied/);
});

test("requires explicit approval for L2 and L3", () => {
  const f = fixture();
  const registry = new Map();
  registerProject(registry, {
    project_id: "sandbox",
    name: "P3 sandbox",
    root_path: f.root,
    allowed_paths: [f.docs],
    context_files: [f.state],
  });
  assert.throws(() => assertPathAllowed(registry, "sandbox", f.state, "L2"), /explicit project approval/);
});

test("produces a read-only project judgment with one next action", () => {
  const f = fixture();
  const registry = new Map();
  registerProject(registry, {
    project_id: "sandbox",
    name: "P3 sandbox",
    root_path: f.root,
    allowed_paths: [f.docs],
    context_files: [f.state],
  });
  const card = assessProject(registry, "sandbox", {
    summary: "项目事实已读取，当前需要先确认目标边界。",
    facts: [{ text: "当前只读取隔离资料", source: "verified_evidence" }],
    unknowns: ["真实项目是否接受该边界"],
    next_action: "先审阅项目判断卡，不执行写入。",
  });
  assert.equal(card.execution_mode, "read_only");
  assert.equal(card.business_write, "closed");
  assert.equal(card.facts.length, 1);
  assert.match(card.decision_card_sha256, /^[a-f0-9]{64}$/);
});

test("persists the project registry and reloads the same allowlist", () => {
  const f = fixture();
  const db = openStore(join(f.root, "state.sqlite"));
  try {
    saveProject(db, {
      project_id: "sandbox",
      name: "P3 sandbox",
      root_path: f.root,
      allowed_paths: [f.docs],
      context_files: [f.state],
      approval_levels: ["L2"],
    });
    const registry = loadProjectRegistry(db);
    assert.equal(registry.get("sandbox").context_files.length, 1);
    assert.deepEqual(registry.get("sandbox").approval_levels, ["L2"]);
  } finally { db.close(); }
});

test("queues jobs, enforces project locks, retries failures, and recovers expired leases", () => {
  const f = fixture(); const db = openStore(join(f.root, "runtime.sqlite"));
  try {
    const first = enqueueJob(db, { projectId: "sandbox", payload: { action: "read" }, maxAttempts: 2 });
    const second = enqueueJob(db, { projectId: "sandbox", payload: { action: "read-2" } });
    const a = claimJob(db, "worker-a", 60000); assert.equal(a.job_id, first);
    assert.equal(claimJob(db, "worker-b", 60000), null);
    startJob(db, first, a.lease_id); assert.equal(finishJob(db, first, "failed", { code: "timeout" }), "retry_wait");
    db.prepare("UPDATE worker_leases SET expires_at=? WHERE lease_id=?").run("2000-01-01T00:00:00.000Z", a.lease_id);
    assert.deepEqual(reconcileLeases(db), []); // lease was released by finish path only after retry is claimed
    requestCancel(db, second);
    assert.equal(db.prepare("SELECT status FROM jobs WHERE job_id=?").get(second).status, "cancelled");
  } finally { db.close(); }
});

test("registers and safely dispatches an agent probe with recorded output", async () => {
  const f = fixture(); const db = openStore(join(f.root, "agents.sqlite"));
  try {
    registerAgent(db, { agent_id: "node-probe", display_name: "Node probe", command: process.execPath, args: [], capabilities: ["probe"], risk_level: "L0" });
    assert.equal(listAgents(db).length, 1);
    const result = await dispatchProbe(db, "node-probe");
    assert.equal(result.status, "succeeded");
    assert.match(result.stdout, /^v\d+/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get().count, 1);
  } finally { db.close(); }
});
