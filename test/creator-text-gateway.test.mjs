import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";

test("real creator text becomes a bounded state proposal with targeted questions", async () => {
  const db = openStore(join(mkdtempSync(join(tmpdir(), "tianshu-creator-text-")), "state.sqlite"));
  const gateway = createGateway({ db }); const address = await gateway.listen();
  await fetch(`http://${address.address}:${address.port}/v1/state/subjects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject_id: "creator", display_name: "Creator", initial_state: { stable: {}, current: {}, future: {} }, source: { type: "creator_seed", ref: "test" } }) });
  try {
    const response = await fetch(`http://${address.address}:${address.port}/v1/state/creator/propose-from-text`, { method: "POST", headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify({ text: "我主航道是高校教育和产教融合。澳大利亚合作有重大变化，工信秘书长和政府内部开始推进成立公司。我最近很忙，但后天要和家人出去玩。以后还要接入手机和硬件，让天枢每天主动总结。" }) });
    const responseText = await response.clone().text();
    assert.equal(response.status, 201, responseText);
    const body = await response.json();
    assert.equal(body.decision_card.status, "awaiting_creator_decision");
    assert.ok(body.extraction.signals.length >= 4);
    assert.ok(body.extraction.questions.length <= 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM state_snapshots WHERE subject_id='creator'").get().count, 1);
  } finally { await gateway.close(); db.close(); }
});
