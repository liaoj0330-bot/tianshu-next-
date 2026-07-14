import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";

test("gateway exposes state proposal and creator decision loop", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-state-gateway-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  const address = await gateway.listen();
  const base = `http://${address.address}:${address.port}`;
  try {
    const subject = await fetch(`${base}/v1/state/subjects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject_id: "creator", display_name: "Creator", initial_state: { stable: { mission: "education" }, current: {}, future: {} }, source: { type: "creator_explicit" } }) }).then((r) => r.json());
    assert.equal(subject.subject_id, "creator");
    const proposal = await fetch(`${base}/v1/state/creator/propose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ observed_at: "2026-07-14T00:00:00.000Z", signals: [{ path: "current.focus", operation: "set", value: "TianShu", confidence: "high", source_type: "creator_explicit" }] }) }).then((r) => r.json());
    assert.equal(proposal.decision_card.creator_options.length, 3);
    const decision = await fetch(`${base}/v1/state/creator/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cycle_id: proposal.cycle_id, decision: "accept" }) }).then((r) => r.json());
    assert.equal(decision.status, "accepted");
    const current = await fetch(`${base}/v1/state/creator`).then((r) => r.json());
    assert.equal(current.state.current.focus, "TianShu");
  } finally { await gateway.close(); db.close(); }
});
