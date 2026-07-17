import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { registerCreatorIncubationProjects } from "../src/creator/incubation-projects.mjs";
import { getCreatorPortfolio } from "../src/creator/project-priority.mjs";
import { getProjectCurrentState } from "../src/creator/project-changes.mjs";

const runtime = resolve(".incubation-projects-test-runtime");

test("quant and crystal are formal secondary projects without creating execution state", () => {
  rmSync(runtime, { recursive: true, force: true });
  const db = openStore(join(runtime, "state.sqlite"));
  try {
    const before = {
      goals: db.prepare("SELECT COUNT(*) count FROM goals").get().count,
      plans: db.prepare("SELECT COUNT(*) count FROM plans").get().count,
      tasks: db.prepare("SELECT COUNT(*) count FROM tasks").get().count,
      runs: db.prepare("SELECT COUNT(*) count FROM runs").get().count,
      jobs: db.prepare("SELECT COUNT(*) count FROM jobs").get().count,
    };

    registerCreatorIncubationProjects(db);
    const firstChangeCount = db.prepare("SELECT COUNT(*) count FROM project_change_candidates").get().count;
    registerCreatorIncubationProjects(db);
    const secondChangeCount = db.prepare("SELECT COUNT(*) count FROM project_change_candidates").get().count;

    const portfolio = getCreatorPortfolio(db);
    const quant = portfolio.find((item) => item.project_key === "ai_quant_research");
    const crystal = portfolio.find((item) => item.project_key === "crystal_diy_system");
    assert.equal(quant.lane, "incubation");
    assert.equal(quant.status, "waiting");
    assert.equal(quant.execution_policy, "read_only");
    assert.equal(quant.assessment.priority_band, "maintain");
    assert.equal(quant.assessment.status, "confirmed");
    assert.equal(crystal.lane, "incubation");
    assert.equal(crystal.status, "waiting");
    assert.equal(crystal.execution_policy, "eligible_after_approval");
    assert.equal(crystal.assessment.priority_band, "maintain");
    assert.equal(crystal.assessment.status, "confirmed");
    assert.deepEqual(getProjectCurrentState(db, "ai_quant_research").risk.value.prohibited_actions, [
      "自动交易", "资金操作", "连接券商或交易账户", "直接执行实盘",
    ]);
    assert.equal(getProjectCurrentState(db, "crystal_diy_system").note.value.execution_started, false);
    assert.equal(secondChangeCount, firstChangeCount, "re-registering must not duplicate accepted project state");
    assert.deepEqual({
      goals: db.prepare("SELECT COUNT(*) count FROM goals").get().count,
      plans: db.prepare("SELECT COUNT(*) count FROM plans").get().count,
      tasks: db.prepare("SELECT COUNT(*) count FROM tasks").get().count,
      runs: db.prepare("SELECT COUNT(*) count FROM runs").get().count,
      jobs: db.prepare("SELECT COUNT(*) count FROM jobs").get().count,
    }, before);
  } finally {
    db.close();
    rmSync(runtime, { recursive: true, force: true });
  }
});
