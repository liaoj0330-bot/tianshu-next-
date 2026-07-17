import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import { sendAgentHubMessage } from "../src/gateway/agenthub-adapter.mjs";
import { getRecordContext, setRecordContext } from "../src/product/record-context.mjs";

test("acceptance input stays auditable but is separated from primary product work", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-record-context-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  const address = await gateway.listen();
  const base = `http://${address.address}:${address.port}`;
  try {
    const accepted = await sendAgentHubMessage(base, "为隔离目录生成一个只读验收计划", {
      conversationId: "acceptance-context",
      messageId: "acceptance-context-1",
      idempotencyKey: "acceptance-context-1",
      metadata: { context_kind: "acceptance", context_reason: "executable contract test" },
    });
    const context = getRecordContext(db, "intake", accepted.intake_id);
    assert.equal(context.context_kind, "acceptance");
    assert.equal(context.visibility, "secondary");

    const today = await fetch(`${base}/v1/today`).then((response) => response.json());
    const plan = today.confirmations.find((item) => item.type === "plan" && item.result.intake_id === accepted.intake_id);
    assert.ok(plan);
    assert.equal(plan.context.context_kind, "acceptance");
    assert.equal(plan.context.visibility, "secondary");
    assert.equal(plan.presentation.type_label, "计划确认");
    assert.equal(plan.presentation.impact, "planning");
    assert.equal(today.decision_summary.primary, 0);
    assert.ok(today.decision_summary.secondary >= 1);

    setRecordContext(db, {
      entity_type: "intake",
      entity_id: accepted.intake_id,
      context_kind: "product",
      visibility: "primary",
      source: "creator_correction",
      reason: "this is real product work",
      classified_by: "local_creator",
    });
    assert.equal(db.prepare("SELECT COUNT(*) count FROM record_context_revisions WHERE entity_type='intake' AND entity_id=?").get(accepted.intake_id).count, 2);
    const corrected = await fetch(`${base}/v1/today`).then((response) => response.json());
    assert.equal(corrected.confirmations.find((item) => item.confirmation_id === plan.confirmation_id).context.context_kind, "product");
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
