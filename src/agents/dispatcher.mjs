import { spawn } from "node:child_process";
import { newId, now, appendEvent } from "../core/store.mjs";
import { getAgent } from "./registry.mjs";

function runCommand(command, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stdout = ""; let stderr = ""; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ exitCode: null, stdout, stderr: `${stderr}${error.message}`, timedOut }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ exitCode: code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut }); });
  });
}

export async function dispatchProbe(db, agentId, jobId = null, timeoutMs = 15000) {
  const agent = getAgent(db, agentId); const runId = newId("agent_run"); const started = now();
  db.prepare("INSERT INTO agent_runs VALUES (?, ?, ?, 'probe', 'running', NULL, '', '', ?, NULL)").run(runId, agentId, jobId, started);
  appendEvent(db, "agent_run", runId, "agent_run.started", { agent_id: agentId, mode: "probe" });
  const result = await runCommand(agent.command, [...agent.args, "--version"], timeoutMs);
  const status = result.exitCode === 0 && !result.timedOut ? "succeeded" : "failed";
  db.prepare("UPDATE agent_runs SET status=?,exit_code=?,stdout=?,stderr=?,finished_at=? WHERE agent_run_id=?")
    .run(status, result.exitCode, result.stdout, result.stderr, now(), runId);
  appendEvent(db, "agent_run", runId, `agent_run.${status}`, { exit_code: result.exitCode, timed_out: result.timedOut });
  return { agent_run_id: runId, agent_id: agentId, status, ...result };
}

export async function dispatchTextTask(db, agentId, prompt, { jobId = null, timeoutMs = 120000 } = {}) {
  if (!prompt || typeof prompt !== "string") throw new Error("text task requires a prompt");
  const agent = getAgent(db, agentId); const runId = newId("agent_run"); const started = now();
  db.prepare("INSERT INTO agent_runs VALUES (?, ?, ?, 'text_task', 'running', NULL, '', '', ?, NULL)").run(runId, agentId, jobId, started);
  appendEvent(db, "agent_run", runId, "agent_run.started", { agent_id: agentId, mode: "text_task" });
  const result = await runCommand(agent.command, [...agent.args, prompt], timeoutMs);
  const status = result.exitCode === 0 && !result.timedOut ? "succeeded" : "failed";
  db.prepare("UPDATE agent_runs SET status=?,exit_code=?,stdout=?,stderr=?,finished_at=? WHERE agent_run_id=?")
    .run(status, result.exitCode, result.stdout, result.stderr, now(), runId);
  appendEvent(db, "agent_run", runId, `agent_run.${status}`, { exit_code: result.exitCode, timed_out: result.timedOut });
  return { agent_run_id: runId, agent_id: agentId, status, ...result };
}
