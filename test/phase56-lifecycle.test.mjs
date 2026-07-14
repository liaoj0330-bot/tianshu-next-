import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openStore } from "../src/core/store.mjs";
import { registerAgent } from "../src/agents/registry.mjs";
import { dispatchTextTask } from "../src/agents/dispatcher.mjs";
import { enqueueJob, claimJob, startJob, requestCancel, finishJob } from "../src/runtime/governance.mjs";
import { prepareManagedTask, dispatchManagedAgentTask, dispatchIndependentReview } from "../src/orchestration/pipeline.mjs";

function store() { return openStore(join(mkdtempSync(join(tmpdir(), "tianshu-p56-")), "state.sqlite")); }
function project(db) { db.prepare("INSERT INTO projects VALUES ('p','P','sandbox','test','L0','[]',datetime('now'),datetime('now'))").run(); }

test("timeout is persisted and retried until max attempts", async () => {
  const db=store(); project(db); registerAgent(db,{agent_id:"slow",display_name:"Slow",command:process.execPath,args:["-e","setTimeout(()=>{},5000)"],capabilities:["text_task"],risk_level:"L0"});
  const jobId=enqueueJob(db,{projectId:"p",maxAttempts:2}); const lease=claimJob(db,"w"); startJob(db,jobId,lease.lease_id);
  const run=await dispatchTextTask(db,"slow","x",{jobId,timeoutMs:50}); assert.equal(run.status,"timed_out");
  assert.equal(finishJob(db,jobId,"timed_out"),"retry_wait");
  assert.equal(db.prepare("SELECT code FROM failure_cases WHERE job_id=?").get(jobId).code,"timeout");
  await new Promise((resolve)=>setTimeout(resolve,120)); const retry=claimJob(db,"w2"); startJob(db,jobId,retry.lease_id);
  assert.equal(finishJob(db,jobId,"timed_out"),"failed"); assert.equal(db.prepare("SELECT attempts FROM jobs WHERE job_id=?").get(jobId).attempts,2); db.close();
});

test("running cancellation terminates the agent and never retries", async () => {
  const db=store(); project(db); registerAgent(db,{agent_id:"slow",display_name:"Slow",command:process.execPath,args:["-e","setTimeout(()=>{},5000)"],capabilities:["text_task"],risk_level:"L0"});
  const jobId=enqueueJob(db,{projectId:"p",maxAttempts:3}); const lease=claimJob(db,"w"); startJob(db,jobId,lease.lease_id);
  const pending=dispatchTextTask(db,"slow","x",{jobId,timeoutMs:5000}); setTimeout(()=>requestCancel(db,jobId),80);
  const run=await pending; assert.equal(run.status,"cancelled"); assert.equal(run.cancelled,true);
  assert.equal(finishJob(db,jobId,"cancelled"),"cancelled"); assert.equal(db.prepare("SELECT count(*) n FROM failure_cases WHERE job_id=?").get(jobId).n,0); db.close();
});

test("independent review rejects self-review and persists another agent verdict", async () => {
  const db=store();
  registerAgent(db,{agent_id:"executor",display_name:"Executor",command:process.execPath,args:["-e","console.log('DONE')"],capabilities:["text_task"],risk_level:"L0"});
  registerAgent(db,{agent_id:"reviewer",display_name:"Reviewer",command:process.execPath,args:["-e",`console.log(JSON.stringify({verdict:"pass",checks:[{name:"evidence",passed:true,evidence:"SQLite executor run inspected"}]}))`],capabilities:["text_task"],risk_level:"L0"});
  const prepared=prepareManagedTask(db,{contract:{objective:"isolated task",completion_criteria:["review"]},plan:{action:"text",allowed_paths:[]},riskLevel:"L0",autoApprove:true});
  const executed=await dispatchManagedAgentTask(db,{taskId:prepared.taskId,agentId:"executor",prompt:"do"});
  await assert.rejects(dispatchIndependentReview(db,{runId:executed.runId,executorAgentId:"executor",reviewerAgentId:"executor",prompt:"review"}),/different agent/);
  const reviewed=await dispatchIndependentReview(db,{runId:executed.runId,executorAgentId:"executor",reviewerAgentId:"reviewer",prompt:"review"});
  assert.equal(reviewed.passed,true); assert.equal(db.prepare("SELECT verifier FROM verifications WHERE run_id=?").get(executed.runId).verifier,"agent:reviewer"); db.close();
});


test("reviewer PASS cannot turn a failed executor result into success", async () => {
  const db=store();
  registerAgent(db,{agent_id:"failed-executor",display_name:"Failed Executor",command:process.execPath,args:["-e","process.exit(7)"],capabilities:["text_task"],risk_level:"L0"});
  registerAgent(db,{agent_id:"pass-reviewer",display_name:"Pass Reviewer",command:process.execPath,args:["-e","console.log('PASS')"],capabilities:["text_task"],risk_level:"L0"});
  const prepared=prepareManagedTask(db,{contract:{objective:"reject false success",completion_criteria:["review"]},plan:{action:"text",allowed_paths:[]},riskLevel:"L0",autoApprove:true});
  const executed=await dispatchManagedAgentTask(db,{taskId:prepared.taskId,agentId:"failed-executor",prompt:"do"});
  const reviewed=await dispatchIndependentReview(db,{runId:executed.runId,executorAgentId:"failed-executor",reviewerAgentId:"pass-reviewer",prompt:"review"});
  assert.equal(reviewed.passed,false); const report=JSON.parse(db.prepare("SELECT report_json FROM verifications WHERE run_id=?").get(executed.runId).report_json);
  assert.match(report.evidence_sha256,/^[a-f0-9]{64}$/); db.close();
});
test("plain PASS is rejected because independent review requires structured evidence", async () => {
  const db=store(); project(db);
  registerAgent(db,{agent_id:"executor",display_name:"Executor",command:process.execPath,args:["-e","console.log('done')"],capabilities:["text_task"],risk_level:"L0"});
  registerAgent(db,{agent_id:"weak-reviewer",display_name:"Weak Reviewer",command:process.execPath,args:["-e","console.log('PASS')"],capabilities:["text_task"],risk_level:"L0"});
  const prepared=prepareManagedTask(db,{contract:{objective:"reject weak review",completion_criteria:["structured evidence"]},plan:{action:"text",allowed_paths:[]},riskLevel:"L0",autoApprove:true});
  const executed=await dispatchManagedAgentTask(db,{taskId:prepared.taskId,agentId:"executor",prompt:"execute"});
  const reviewed=await dispatchIndependentReview(db,{runId:executed.runId,executorAgentId:"executor",reviewerAgentId:"weak-reviewer",prompt:"review"});
  assert.equal(reviewed.passed,false); db.close();
});

test("terminal jobs reject cancellation and duplicate finish transitions", () => {
  const db=store(); project(db); const jobId=enqueueJob(db,{projectId:"p",maxAttempts:1});
  const lease=claimJob(db,"w"); startJob(db,jobId,lease.lease_id); assert.equal(finishJob(db,jobId,"succeeded"),"succeeded");
  assert.throws(()=>requestCancel(db,jobId),/terminal/); assert.throws(()=>finishJob(db,jobId,"failed"),/must be running/); db.close();
});
