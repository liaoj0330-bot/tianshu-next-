import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { assessCreatorProject, getCreatorPortfolio, scoreCreatorProject, upsertCreatorProjectBaseline } from "../src/creator/project-priority.mjs";

const runtime = resolve(".creator-project-test-runtime");
let db;
beforeEach(() => { db?.close(); rmSync(runtime, { recursive: true, force: true }); db = openStore(join(runtime, "state.sqlite")); });
const source = { kind: "formal_creator_model", reference: "00_?????/05_???????.md", version: "2026-07-13" };
const factors = { mission_alignment: 5, system_asset_leverage: 5, time_window: 4, evidence_quality: 4, dependency_urgency: 4, resource_pressure: 2 };

test("portfolio baseline is auditable and no-access projects cannot become execution targets", () => {
  upsertCreatorProjectBaseline(db, { source, projects: [
    { project_key: "higher_ed", display_name: "?? AI ????", lane: "main", baseline_priority: 5, execution_policy: "eligible_after_approval", status: "active", evidence: ["formal priority"] },
    { project_key: "protected_ppt", display_name: "??????", lane: "capability", baseline_priority: 2, execution_policy: "no_access", status: "protected", evidence: ["boundary"] }
  ] });
  const portfolio = getCreatorPortfolio(db);
  assert.equal(portfolio.length, 2);
  assert.equal(portfolio.find((item) => item.project_key === "protected_ppt").execution_policy, "no_access");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count, 0);
});

test("assessment is explainable, candidate by default, and supersedes prior assessment", () => {
  upsertCreatorProjectBaseline(db, { source, projects: [{ project_key: "tianshu", display_name: "??", lane: "main", baseline_priority: 5, execution_policy: "eligible_after_approval", status: "active", evidence: [] }] });
  const first = assessCreatorProject(db, "tianshu", { factors, source: { kind: "creator_update", reference: "test" } });
  assert.equal(first.status, "candidate");
  assert.equal(first.priority_band, "focus_now");
  const confirmed = assessCreatorProject(db, "tianshu", { factors: { ...factors, evidence_quality: 5 }, source: { kind: "creator_confirmation", reference: "test" }, confirm: true });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(getCreatorPortfolio(db)[0].assessment.status, "confirmed");
});

test("invalid factor values fail closed", () => {
  assert.throws(() => scoreCreatorProject({ ...factors, time_window: 6 }), /time_window/);
});
