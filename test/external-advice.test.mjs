import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { openStore, sha256 } from "../src/core/store.mjs";
import {
  decideAdvisoryRecommendation,
  ingestAdvisoryDocument,
  listAdvisoryRecommendations,
} from "../src/advisory/external-advice.mjs";
import { WU_20260714_REVIEW } from "../src/advisory/wu-20260714-review.mjs";

const DOCUMENTS = [
  ["TS-HO-02", "言出法随：项目总纲与核心原则"],
  ["TS-HO-03", "天枢：项目阶段履历与当前状态"],
  ["TS-HO-06", "天枢：审美体系与产品体验规范"],
  ["TS-HO-05", "工程资产与协作规则"],
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tianshu-advisory-"));
  return { root, db: openStore(join(root, "state.sqlite")) };
}

function ingestAll(db) {
  return DOCUMENTS.map(([documentId, title]) => ingestAdvisoryDocument(db, {
    source_kind: "wu_teacher_document",
    document_id: documentId,
    title,
    author: "吴老师",
    external_ref: "fixture://" + documentId,
    content_hash: sha256("fixture-content:" + documentId),
    trust_scope: "advisory_only",
    recommendations: WU_20260714_REVIEW[documentId],
  }));
}

test("Wu documents become idempotent advisory candidates instead of formal truth", () => {
  const { root, db } = fixture();
  try {
    const first = ingestAll(db);
    const second = ingestAll(db);
    assert.equal(first.length, 4);
    assert.deepEqual(second.map((item) => item.source_id), first.map((item) => item.source_id));
    assert.equal(db.prepare("SELECT COUNT(*) count FROM advisory_sources").get().count, 4);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM advisory_recommendations").get().count, 13);
    assert.equal(listAdvisoryRecommendations(db, { status: "awaiting_creator_decision" }).length, 13);
    assert.throws(() => ingestAdvisoryDocument(db, {
      source_kind: "external_document",
      document_id: "unauthorized",
      title: "unauthorized",
      author: "external",
      external_ref: "fixture://unauthorized",
      content_hash: sha256("unauthorized"),
      recommendations: WU_20260714_REVIEW["TS-HO-02"],
      created_by: "external_advisor",
    }), /not authorized for machine_state\.transition/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("only the local creator can decide advice and every decision stays append-only", () => {
  const { root, db } = fixture();
  try {
    ingestAll(db);
    const items = listAdvisoryRecommendations(db);
    const sovereignty = items.find((item) => item.recommendation_key === "creator-sovereignty");
    const wuAuthority = items.find((item) => item.recommendation_key === "wu-final-authority");

    assert.throws(() => decideAdvisoryRecommendation(db, sovereignty.recommendation_id, {
      disposition: "adapt",
      adaptation: { creator_id: "nainai" },
      decided_by: "agenthub",
    }), /agenthub is not authorized for formal_state\.confirm/);

    const adapted = decideAdvisoryRecommendation(db, sovereignty.recommendation_id, {
      disposition: "adapt",
      adaptation: { creator_id: "nainai", rule: "AI proposes; Nainai decides." },
      reason: "Authority must match the actual creator.",
      decided_by: "nainai",
    });
    assert.equal(adapted.status, "adapted");
    assert.equal(adapted.decision.decided_by, "local_creator");
    assert.equal(adapted.decision.adaptation.creator_id, "nainai");

    const rejected = decideAdvisoryRecommendation(db, wuAuthority.recommendation_id, {
      disposition: "reject",
      reason: "An external advisor cannot own Nainai's system.",
      decided_by: "奈奈",
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.decision.decided_by, "local_creator");
    assert.throws(() => decideAdvisoryRecommendation(db, wuAuthority.recommendation_id, {
      disposition: "reject",
      decided_by: "nainai",
    }), /already decided/);

    assert.throws(() => db.prepare("UPDATE advisory_recommendations SET assessment='changed' WHERE recommendation_id=?").run(sovereignty.recommendation_id), /immutable/);
    assert.throws(() => db.prepare("DELETE FROM advisory_sources WHERE source_id=?").run(sovereignty.source_id), /append-only/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
