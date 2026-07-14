import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { openStore } from "../src/core/store.mjs";
import { prepareManagedTask, recordManagedExecution } from "../src/orchestration/pipeline.mjs";
import { writeStatusMirror } from "../src/writeback/status.mjs";

test("status writeback mirrors SQLite evidence into readable markdown", () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-writeback-")); const db = openStore(join(root, "state.sqlite"));
  const p = prepareManagedTask(db, { contract: { objective: "writeback", completion_criteria: ["mirror"] }, plan: { action: "read", allowed_paths: [] }, riskLevel: "L0", autoApprove: true });
  recordManagedExecution(db, p.taskId, { claim: "done" }, { passed: true, report: { ok: true } }, { decision: "accept", reason: "verified" });
  const path = writeStatusMirror(db, join(root, "status.md")); const content = readFileSync(path, "utf8");
  assert.match(content, /SQLite/); assert.match(content, /接受：1/); db.close();
});
