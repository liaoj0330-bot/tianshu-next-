import { createGoal, proposePlan, decideApproval, startRun, recordExecutorResult, verifyRun, decideRun, getPlanHash } from "../core/kernel.mjs";
import { dispatchTextTask } from "../agents/dispatcher.mjs";

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
