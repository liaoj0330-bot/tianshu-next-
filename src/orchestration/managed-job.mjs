import { getAgent } from "../agents/registry.mjs";
import { dispatchIndependentReview, dispatchManagedAgentTask } from "./pipeline.mjs";

function parse(value, fallback = {}) {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
}

export async function executeManagedTaskJob({ db, job, payload }) {
  const taskId = payload?.task_id;
  if (!taskId) throw new Error("managed execution requires task_id");
  const row = db.prepare(`
    SELECT t.task_id,t.status task_status,p.plan_json,g.contract_json,
           b.boundary_json,b.status boundary_status
    FROM tasks t
    JOIN plans p ON p.plan_id=t.plan_id
    JOIN goals g ON g.goal_id=p.goal_id
    JOIN execution_boundaries b ON b.plan_id=p.plan_id
    WHERE t.task_id=?
  `).get(taskId);
  if (!row || row.task_status !== "approved" || row.boundary_status !== "approved") {
    throw new Error("task and execution boundary must be approved before start");
  }

  const plan = parse(row.plan_json);
  const contract = parse(row.contract_json);
  const boundary = parse(row.boundary_json);
  getAgent(db, boundary.executor_agent);
  getAgent(db, boundary.verifier_agent);
  const cwd = boundary.allowed_paths?.[0] ?? process.cwd();
  const executorPrompt = [
    "Execute this creator-approved TianShu task.",
    `Objective: ${contract.objective}`,
    `Completion criteria: ${JSON.stringify(contract.completion_criteria ?? [])}`,
    `Approved plan: ${JSON.stringify(plan)}`,
    `Allowed paths: ${JSON.stringify(boundary.allowed_paths ?? [])}`,
    "Do not access anything outside the approved paths. Report concrete outputs and evidence."
  ].join("\n");
  const execution = await dispatchManagedAgentTask(db, {
    taskId,
    agentId: boundary.executor_agent,
    prompt: executorPrompt,
    jobId: job?.job_id ?? null,
    timeoutMs: boundary.timeout_ms,
    cwd,
  });

  const reviewPrompt = [
    "Independently verify the executor result against the approved objective and completion criteria.",
    `Objective: ${contract.objective}`,
    `Completion criteria: ${JSON.stringify(contract.completion_criteria ?? [])}`,
    `Allowed paths: ${JSON.stringify(boundary.allowed_paths ?? [])}`,
    `Executor result: ${execution.executor.stdout}`,
    "Return JSON only: {\"verdict\":\"pass\"|\"fail\",\"checks\":[{\"name\":\"...\",\"passed\":true|false,\"evidence\":\"...\"}]}"
  ].join("\n");
  const verification = await dispatchIndependentReview(db, {
    runId: execution.runId,
    executorAgentId: boundary.executor_agent,
    reviewerAgentId: boundary.verifier_agent,
    prompt: reviewPrompt,
    timeoutMs: boundary.timeout_ms,
    cwd,
  });
  return { task_id: taskId, run_id: execution.runId, verification };
}
