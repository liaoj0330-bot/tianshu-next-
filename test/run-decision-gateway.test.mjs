import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import { prepareManagedTask, recordManagedExecution } from "../src/orchestration/pipeline.mjs";

test("independently verified run appears for creator decision and only creator acceptance completes it", async () => {
  const root=mkdtempSync(join(tmpdir(),"tianshu-run-decision-")); const db=openStore(join(root,"state.sqlite"));
  const prepared=prepareManagedTask(db,{contract:{objective:"verify one isolated file",completion_criteria:["file exact"]},plan:{action:"write",allowed_paths:["acceptance"]},riskLevel:"L0",autoApprove:true});
  const execution=recordManagedExecution(db,prepared.taskId,{claim:"wrote file",status:"succeeded",exit_code:0},{passed:true,verifier:"agent:reviewer",report:{reviewer_report:{verdict:"pass",checks:[{name:"content",passed:true,evidence:"exact bytes"}]},evidence_sha256:"abc"}});
  assert.equal(db.prepare("SELECT status FROM goals WHERE goal_id=?").get(prepared.goalId).status,"awaiting_creator_decision");
  const gateway=createGateway({db}); const address=await gateway.listen(); const base=`http://${address.address}:${address.port}`;
  try {
    const today=await fetch(`${base}/v1/today`).then(r=>r.json()); const item=today.confirmations.find(x=>x.type==="run_decision");
    assert.equal(item.confirmation_id,execution.runId); assert.equal(item.result.interaction.run_candidate.verification_passed,true); assert.equal(item.result.interaction.run_candidate.report.reviewer_report.checks[0].evidence,"exact bytes");
    const response=await fetch(`${base}/v1/runs/${execution.runId}/decision`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision:"accept",reason:"creator checked evidence",decided_by:"creator"})}); assert.equal(response.status,200);
    assert.equal(db.prepare("SELECT status FROM goals WHERE goal_id=?").get(prepared.goalId).status,"completed"); assert.equal(db.prepare("SELECT decided_by FROM decisions WHERE run_id=?").get(execution.runId).decided_by,"creator");
  } finally { await gateway.close(); db.close(); rmSync(root,{recursive:true,force:true}); }
});