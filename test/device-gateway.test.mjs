import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";

test("phone and hardware events enter the same gateway intake", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-device-gateway-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db }); const address = await gateway.listen();
  try {
    const response = await fetch(`http://${address.address}:${address.port}/v1/device/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device_id: "phone-test", event_type: "voice_note", payload: { text: "今天项目进展很好，但生活安排还没有确定" }, observed_at: "2026-07-14T12:00:00.000Z" }) });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.routed_to, "tianshu-orchestrator");
    assert.equal(body.analysis.operating_domain, "mixed_with_separate_records");
  } finally { await gateway.close(); db.close(); }
});
