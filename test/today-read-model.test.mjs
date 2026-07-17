import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import { createStateSubject, proposeStateUpdate } from "../src/state/dynamic-state.mjs";
import { assessCreatorProject, upsertCreatorProjectBaseline } from "../src/creator/project-priority.mjs";

test("today read model keeps a truthful empty state without demo data", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-today-empty-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  const address = await gateway.listen();
  try {
    const today = await fetch(`http://${address.address}:${address.port}/v1/today`).then((response) => response.json());
    assert.equal(today.state_authority, "sqlite");
    assert.equal(today.focus, null);
    assert.deepEqual(today.projects, []);
    assert.equal(today.protected_project_count, 0);
    assert.equal("protected_projects" in today, false);
    assert.deepEqual(today.confirmations, []);
    assert.deepEqual(today.recent_records, []);
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("today read model is SQLite-driven, human-readable, and separates protected projects", async () => {
  const root=mkdtempSync(join(tmpdir(),"tianshu-today-")); const db=openStore(join(root,"state.sqlite"));
  createStateSubject(db,{subject_id:"creator",display_name:"奈奈",initial_state:{stable:{},current:{wellbeing:{energy:"medium"}},future:{}},source:{type:"creator_explicit"}});
  upsertCreatorProjectBaseline(db,{source:{kind:"creator_explicit",reference:"test",version:"1"},projects:[{project_key:"tianshu",display_name:"天枢个人 AI 工作操作系统",lane:"main",baseline_priority:5,execution_policy:"eligible_after_approval",status:"active",evidence:[]},{project_key:"protected",display_name:"受保护能力",lane:"protected",baseline_priority:5,execution_policy:"no_access",status:"protected",evidence:[]}]});
  assessCreatorProject(db,"tianshu",{factors:{mission_alignment:5,system_asset_leverage:5,time_window:5,evidence_quality:4,dependency_urgency:4,resource_pressure:1},source:{kind:"test",reference:"score"}});
  proposeStateUpdate(db,"creator",{observed_at:new Date().toISOString(),signals:[{path:"current.wellbeing.energy",operation:"set",value:"low",confidence:"high",source_type:"creator_explicit"}]});
  const gateway=createGateway({db}); const address=await gateway.listen();
  try { const today=await fetch(`http://${address.address}:${address.port}/v1/today`).then(r=>r.json()); assert.equal(today.state_authority,"sqlite"); assert.equal(today.decision_authority,"local_creator"); assert.equal(today.creator_profile.display_name,"使用者"); assert.equal(today.focus.project_key,"tianshu"); assert.equal(today.projects.length,1); assert.equal(today.projects[0].posture.trend.direction,"new"); assert.equal(today.projects[0].posture.evidence_count,0); assert.ok(today.projects[0].posture.freshness.updated_at); assert.equal(today.protected_project_count,1); assert.equal(JSON.stringify(today).includes("受保护能力"),false); assert.equal(JSON.stringify(today).includes('"protected"'),false); assert.equal(today.confirmations[0].result.interaction.state_candidate.decision_card.changes[0].label,"今日精力状态"); assert.deepEqual(today.confirmations[0].effects,["会更新你的正式状态","不会创建任务","不会派发 Agent"]); } finally { await gateway.close(); db.close(); rmSync(root,{recursive:true,force:true}); }
});
