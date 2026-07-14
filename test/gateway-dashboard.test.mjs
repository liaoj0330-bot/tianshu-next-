import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createGateway } from "../src/gateway/server.mjs";
import { openStore } from "../src/core/store.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

test("dashboard is served by the same gateway as intake", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-dashboard-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  const address = await gateway.listen();
  try {
    const base = `http://${address.address}:${address.port}`;
    const page = await fetch(`${base}/dashboard`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /天枢总控/);
    const intake = await fetch(`${base}/v1/intake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "dashboard", message: "测试目标" }) });
    assert.equal(intake.status, 202);
    const intakeBody = await intake.json();
    assert.deepEqual(intakeBody.analysis.domains, ["uncategorized"]);
    const items = await fetch(`${base}/v1/intakes`).then((r) => r.json());
    assert.equal(items.items.length, 1);
    assert.equal(items.items[0].source, "dashboard");
    const overview = await fetch(`${base}/v1/overview`).then((r) => r.json());
    assert.equal(overview.control_plane, "tianshu-orchestrator");
    assert.equal(overview.counts.intakes, 1);
  } finally { await gateway.close(); db.close(); }
});
