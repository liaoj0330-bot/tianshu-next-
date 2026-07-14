import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openStore } from "../src/core/store.mjs";
import { recordMemoryCandidate, promoteMemoryCandidate, addMemoryCounterexample } from "../src/memory/promotion.mjs";

test("memory requires repetition and rejects counterexamples", () => {
  const db = openStore(join(mkdtempSync(join(tmpdir(), "tianshu-memory-")), "state.sqlite"));
  const first = recordMemoryCandidate(db, { subject_id: "creator", statement: "高校教育是当前事业主航道", scope: "creator", source_id: "a" });
  recordMemoryCandidate(db, { subject_id: "creator", statement: first.statement, scope: "creator", source_id: "b" });
  recordMemoryCandidate(db, { subject_id: "creator", statement: first.statement, scope: "creator", source_id: "c" });
  assert.equal(promoteMemoryCandidate(db, first.candidate_id).status, "promoted");
  const second = recordMemoryCandidate(db, { subject_id: "creator", statement: "临时想法", scope: "current" });
  addMemoryCounterexample(db, second.candidate_id, "后来明确否定");
  recordMemoryCandidate(db, { subject_id: "creator", statement: second.statement, scope: "current" });
  recordMemoryCandidate(db, { subject_id: "creator", statement: second.statement, scope: "current" });
  assert.throws(() => promoteMemoryCandidate(db, second.candidate_id), /counterexamples/);
  db.close();
});
