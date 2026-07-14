import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { upsertCreatorProjectBaseline } from "../src/creator/project-priority.mjs";
import { scanRegisteredProjectChanges } from "../src/creator/project-observer.mjs";
import { saveProject } from "../src/context/project-store.mjs";
import { createGateway } from "../src/gateway/server.mjs";

const runtime = resolve(".project-observer-test-runtime");
let db, gateway;
afterEach(async () => { await gateway?.close(); db?.close(); rmSync(runtime, { recursive: true, force: true }); gateway = null; db = null; });

function setupProject() {
  mkdirSync(runtime, { recursive: true });
  const context = join(runtime, "README.md"); writeFileSync(context, "context");
  db = openStore(join(runtime, "state.sqlite"));
  upsertCreatorProjectBaseline(db, { source: { kind: "test", reference: "observer", version: "1" }, projects: [
    { project_key: "tianshu", display_name: "天枢", lane: "main", baseline_priority: 5, execution_policy: "eligible_after_approval", status: "active" }
  ] });
  saveProject(db, { project_id: "tianshu", name: "天枢", root_path: runtime, allowed_paths: [runtime], context_files: [context], approval_levels: [], default_risk_level: "L1" });
}

test("git observer records a baseline, creates one candidate on change, and deduplicates unchanged scans", () => {
  setupProject();
  let output = "";
  const git = () => ({ status: 0, stdout: output, stderr: "" });
  assert.equal(scanRegisteredProjectChanges(db, { git })[0].status, "baseline_recorded");
  output = " M src/example.mjs\n";
  const changed = scanRegisteredProjectChanges(db, { git })[0];
  assert.equal(changed.status, "candidate_created");
  assert.equal(scanRegisteredProjectChanges(db, { git })[0].status, "unchanged");
  const rows = db.prepare("SELECT * FROM project_change_candidates").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "awaiting_creator_confirmation");
});

test("SSE streams project changes and supports cursor replay", async () => {
  setupProject();
  gateway = createGateway({ db }); const address = await gateway.listen(); const base = "http://" + address.address + ":" + address.port;
  const controller = new AbortController();
  const response = await fetch(base + "/v1/events/stream?after_id=0", { signal: controller.signal });
  assert.equal(response.status, 200);
  const created = await fetch(base + "/v1/creator/projects/tianshu/changes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    change_type: "progress", summary: "SSE真实变化", proposed_value: "changed",
    source: { kind: "test", reference: "sse" }
  }) }).then((r) => r.json());
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let text = ""; const deadline = Date.now() + 4000;
  while (!text.includes(created.change.change_id) && Date.now() < deadline) {
    const next = await reader.read(); if (next.done) break; text += decoder.decode(next.value);
  }
  assert.match(text, /event: project-change/);
  assert.ok(text.includes(created.change.change_id));
  await reader.cancel(); controller.abort();
  const replay = await fetch(base + "/v1/project-changes?after_id=0").then((r) => r.json());
  assert.equal(replay.items[0].change_id, created.change.change_id);
});