import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";

const runtime = resolve(".creator-portfolio-gateway-test-runtime");
let gateway, db;
afterEach(async () => { await gateway?.close(); db?.close(); rmSync(runtime, { recursive: true, force: true }); });
async function request(base, path, init = {}) { const response = await fetch(base + path, { headers: { "content-type": "application/json" }, ...init }); return { status: response.status, body: await response.json() }; }
test("creator portfolio API exposes SQLite projection and preserves candidate confirmation", async () => {
  db = openStore(join(runtime, "state.sqlite")); gateway = createGateway({ db }); const address = await gateway.listen(); const base = `http://${address.address}:${address.port}`;
  const imported = await request(base, "/v1/creator/portfolio/import", { method: "POST", body: JSON.stringify({ source: { kind: "formal_creator_model", reference: "test", version: "2026-07-13" }, projects: [{ project_key: "tianshu", display_name: "TianShu", lane: "main", baseline_priority: 5, execution_policy: "eligible_after_approval", status: "active" }] }) });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  const assessed = await request(base, "/v1/creator/projects/tianshu/assessments", { method: "POST", body: JSON.stringify({ source: { kind: "creator_update", reference: "test" }, factors: { mission_alignment: 5, system_asset_leverage: 5, time_window: 4, evidence_quality: 3, dependency_urgency: 4, resource_pressure: 2 } }) });
  assert.equal(assessed.body.status, "candidate");
  const portfolio = await request(base, "/v1/creator/portfolio");
  assert.equal(portfolio.body.state_authority, "sqlite"); assert.equal(portfolio.body.items[0].assessment.status, "candidate");
});
