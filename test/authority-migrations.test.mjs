import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGoal, decideApproval, decideRun, getPlanHash, proposePlan, recordExecutorResult, startRun, verifyRun } from "../src/core/kernel.mjs";
import { getAuthorityReadModel } from "../src/governance/authority.mjs";
import { getProductProfile, updateProductProfile } from "../src/product/product-profile.mjs";

test("versioned migrations are idempotent and seed the authority baseline", () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-migrations-"));
  const path = join(root, "state.sqlite");
  let db = openStore(path);
  try {
    const migrations = db.prepare("SELECT version,name,checksum FROM schema_migrations ORDER BY version").all();
    assert.deepEqual(migrations.map((item) => item.version), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(migrations[0].name, "authority_and_workspace_assignments");
    assert.equal(migrations[1].name, "judgment_outcome_experience_loop");
    assert.equal(migrations[2].name, "governed_external_advice");
    assert.equal(migrations[3].name, "agenthub_interaction_contract");
    assert.equal(migrations[4].name, "experience_lifecycle_governance");
    assert.equal(migrations[5].name, "product_profile_and_generic_creator_identity");
    assert.equal(migrations[6].name, "record_context_separation");
    assert.equal(migrations[7].name, "reminder_automations");
    assert.equal(migrations[8].name, "agenthub_material_dialogues");
    assert.equal(migrations[0].checksum.length, 64);
    assert.equal(migrations[1].checksum.length, 64);
    assert.equal(migrations[2].checksum.length, 64);
    assert.equal(migrations[3].checksum.length, 64);
    assert.equal(migrations[4].checksum.length, 64);
    assert.equal(migrations[5].checksum.length, 64);
    assert.equal(migrations[6].checksum.length, 64);
    assert.equal(migrations[7].checksum.length, 64);
    assert.equal(migrations[8].checksum.length, 64);
    assert.ok(db.prepare("SELECT COUNT(*) count FROM authority_policies").get().count >= 10);
  } finally {
    db.close();
  }
  db = openStore(path);
  try {
    assert.equal(db.prepare("SELECT COUNT(*) count FROM schema_migrations").get().count, 9);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM authority_policies WHERE policy_version=1").get().count, 16);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM authority_policies WHERE principal_id='local_creator' AND policy_version=2").get().count, 5);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("executor and verifier cannot approve execution or accept a goal", () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-authority-"));
  const db = openStore(join(root, "state.sqlite"));
  try {
    const authority = getAuthorityReadModel(db);
    assert.equal(authority.creator_id, "local_creator");
    assert.equal(authority.creator_profile.display_name, "使用者");
    assert.equal(authority.machine_state_authority, "sqlite");
    assert.equal(authority.interaction_channel, "agenthub");
    assert.equal(authority.knowledge_workbench, "obsidian");

    const goalId = createGoal(db, { objective: "prove authority", completion_criteria: ["verified"] });
    const planId = proposePlan(db, goalId, { action: "test", allowed_paths: [] });
    assert.throws(
      () => decideApproval(db, planId, "approved", getPlanHash(db, planId), "executor"),
      /not authorized for execution\.approve/,
    );
    const { taskId } = decideApproval(db, planId, "approved", getPlanHash(db, planId), "nainai");
    const runId = startRun(db, taskId);
    recordExecutorResult(db, runId, { claim: "done" });
    verifyRun(db, runId, true, { checks: ["evidence"] }, "independent_verifier");
    assert.throws(
      () => decideRun(db, runId, "accept", "verified", "independent_verifier"),
      /not authorized for goal\.final_accept/,
    );
    decideRun(db, runId, "accept", "用户接受独立验证结果", "nainai");
    assert.equal(db.prepare("SELECT status FROM goals WHERE goal_id=?").get(goalId).status, "completed");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("product profile is SQLite-backed, configurable, and revisioned", () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-profile-"));
  const db = openStore(join(root, "state.sqlite"));
  try {
    const initial = getProductProfile(db);
    assert.equal(initial.profile_id, "primary");
    assert.equal(initial.actor_id, "local_creator");
    assert.equal(initial.display_name, "使用者");
    assert.equal(initial.locale, "zh-CN");
    assert.equal(initial.timezone, "Asia/Shanghai");
    assert.equal(initial.onboarding_status, "needs_profile");
    const updated = updateProductProfile(db, {
      display_name: "产品首位用户",
      onboarding_status: "ready",
      updated_by: "creator",
    });
    assert.equal(updated.actor_id, "local_creator");
    assert.equal(updated.display_name, "产品首位用户");
    assert.equal(updated.onboarding_status, "ready");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM product_profile_revisions").get().count, 2);
    assert.throws(() => updateProductProfile(db, { display_name: "越权修改", updated_by: "executor" }), /only the local creator/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
