import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { openStore, sha256 } from "../src/core/store.mjs";
import { ingestAdvisoryDocument } from "../src/advisory/external-advice.mjs";
import { WU_20260714_REVIEW } from "../src/advisory/wu-20260714-review.mjs";
import { createGateway } from "../src/gateway/server.mjs";

async function request(base, path, init = {}) {
  const response = await fetch(base + path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  return { status: response.status, body: await response.json() };
}

test("advice is visible in Today while AgentHub remains an interaction channel", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-advisory-gateway-"));
  const db = openStore(join(root, "state.sqlite"));
  const source = ingestAdvisoryDocument(db, {
    source_kind: "wu_teacher_document",
    document_id: "TS-HO-02",
    title: "言出法随：项目总纲与核心原则",
    author: "吴老师",
    external_ref: "fixture://TS-HO-02",
    content_hash: sha256("TS-HO-02"),
    trust_scope: "advisory_only",
    recommendations: WU_20260714_REVIEW["TS-HO-02"],
  });
  const gateway = createGateway({ db });
  const address = await gateway.listen();
  const base = "http://" + address.address + ":" + address.port;
  try {
    const listed = await request(base, "/v1/advisory/recommendations?status=awaiting_creator_decision");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items.length, 4);
    assert.equal(listed.body.decision_authority, "local_creator");

    const confirmations = await request(base, "/v1/confirmations");
    assert.equal(confirmations.body.items.length, 4);
    assert.equal(confirmations.body.items[0].type, "advisory");
    assert.equal(confirmations.body.items[0].result.interaction.mode, "advisory_decision");

    const detail = await request(base, "/v1/advisory/sources/" + source.source_id);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.source.document_id, "TS-HO-02");
    assert.equal(detail.body.source.recommendations.length, 4);

    const candidate = listed.body.items.find((item) => item.recommendation_key === "creator-sovereignty");
    const denied = await request(base, "/v1/advisory/recommendations/" + candidate.recommendation_id + "/decision", {
      method: "POST",
      body: JSON.stringify({
        disposition: "adapt",
        adaptation: { creator_id: "nainai" },
        decided_by: "agenthub",
      }),
    });
    assert.equal(denied.status, 400);
    assert.match(denied.body.error, /not authorized/);

    const accepted = await request(base, "/v1/advisory/recommendations/" + candidate.recommendation_id + "/decision", {
      method: "POST",
      body: JSON.stringify({
        disposition: "adapt",
        adaptation: { creator_id: "nainai" },
        reason: "Nainai owns TianShu.",
        decided_by: "nainai",
      }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.recommendation.status, "adapted");
    assert.equal(accepted.body.decision_authority, "local_creator");

    const after = await request(base, "/v1/confirmations");
    assert.equal(after.body.items.length, 3);
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
