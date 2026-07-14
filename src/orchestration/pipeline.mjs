import { createGoal, proposePlan, decideApproval, startRun, recordExecutorResult, verifyRun, decideRun, getPlanHash } from "../core/kernel.mjs";
import { dispatchTextTask } from "../agents/dispatcher.mjs";
import { canonicalJson, sha256 } from "../core/store.mjs";

export function prepareManagedTask(db, { contract, plan, riskLevel = "L1", autoApprove = false, decidedBy = "orchestrator" }) {
  const goalId = createGoal(db, contract);
  const planId = proposePlan(db, goalId, plan, riskLevel);
  const result = { goalId, planId, taskId: null, approvalId: null };
  if (autoApprove && ["L0", "L1"].includes(riskLevel)) {
    const approval = decideApproval(db, planId, "approved", getPlanHash(db, planId), decidedBy);
    result.approvalId = approval.approvalId;
    result.taskId = approval.taskId;
  }
  return result;
}

export function recordManagedExecution(db, taskId, executorResult, verification, creatorDecision = null) {
  const runId = startRun(db, taskId);
  recordExecutorResult(db, runId, executorResult);
  verifyRun(db, runId, Boolean(verification.passed), verification.report ?? {}, verification.verifier ?? "independent_verifier");
  const decisionId = creatorDecision
    ? decideRun(db, runId, creatorDecision.decision, creatorDecision.reason ?? "", creatorDecision.decidedBy ?? "creator")
    : null;
  return { runId, decisionId };
}

export async function dispatchManagedAgentTask(db, { taskId, agentId, prompt, jobId = null, timeoutMs = 120000, cwd = process.cwd() }) {
  const runId = startRun(db, taskId);
  const result = await dispatchTextTask(db, agentId, prompt, { jobId, timeoutMs, cwd });
  recordExecutorResult(db, runId, { claim: result.stdout, agent_run_id: result.agent_run_id, status: result.status, exit_code: result.exitCode });
  return { runId, agentRunId: result.agent_run_id, executor: result, next: "independent_verification" };
}

export async function dispatchIndependentReview(db, { runId, executorAgentId, reviewerAgentId, prompt, timeoutMs = 120000, cwd = process.cwd() }) {
  const run = db.prepare("SELECT status,executor_result_json FROM runs WHERE run_id=?").get(runId);
  if (!run || run.status !== "awaiting_verification") throw new Error("run must await verification");
  const recorded = JSON.parse(run.executor_result_json ?? "{}");
  const executorRun = recorded.agent_run_id ? db.prepare("SELECT agent_id FROM agent_runs WHERE agent_run_id=?").get(recorded.agent_run_id) : null;
  if (!executorRun || executorRun.agent_id !== executorAgentId) throw new Error("executor agent identity does not match SQLite evidence");
  if (executorRun.agent_id === reviewerAgentId) throw new Error("independent review requires a different agent");
  const result = await dispatchTextTask(db, reviewerAgentId, prompt, { timeoutMs, cwd });
  const executorSucceeded = recorded.status === "succeeded" && recorded.exit_code === 0;
  let reviewerReport = null;
  try { reviewerReport = JSON.parse(result.stdout.trim()); } catch { /* malformed review is evidence of failure */ }
  const reviewerPassed = result.status === "succeeded"
    && reviewerReport?.verdict === "pass"
    && Array.isArray(reviewerReport.checks)
    && reviewerReport.checks.length > 0
    && reviewerReport.checks.every((check) => check && check.passed === true
      && typeof check.evidence === "string" && check.evidence.trim());
  const verdict = executorSucceeded && reviewerPassed;
  const evidence = { executor_agent_run_id: recorded.agent_run_id, executor_status: recorded.status, executor_exit_code: recorded.exit_code, reviewer_agent_run_id: result.agent_run_id, reviewer_report: reviewerReport, reviewer_raw_output: result.stdout, reviewer_status: result.status };
  const report = { ...evidence, evidence_sha256: sha256(canonicalJson(evidence)) };
  const verificationId = verifyRun(db, runId, verdict, report, "agent:" + reviewerAgentId);
  return { verificationId, passed: verdict, reviewer: result };
}
