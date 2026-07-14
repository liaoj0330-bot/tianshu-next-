import { spawn, spawnSync } from "node:child_process";
import { newId, now, appendEvent } from "../core/store.mjs";
import { getAgent } from "./registry.mjs";

function runCommand(command, args, { timeoutMs = 15000, cwd = process.cwd(), cancelCheck = null, pollMs = 50 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, cwd, detached: process.platform !== "win32" });
    let stdout = ""; let stderr = ""; let timedOut = false; let cancelled = false; let settled = false;
    child.stdin.end();
    const stop = (reason) => {
      if (settled) return;
      timedOut ||= reason === "timeout"; cancelled ||= reason === "cancel";
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } }
    };
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    const cancelTimer = cancelCheck ? setInterval(() => { try { if (cancelCheck()) stop("cancel"); } catch { stop("cancel"); } }, pollMs) : null;
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); if (cancelTimer) clearInterval(cancelTimer); resolve(result); };
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => finish({ exitCode: null, stdout, stderr: stderr + error.message, timedOut, cancelled }));
    child.on("close", (code, signal) => finish({ exitCode: code, signal, stdout: stdout.trim(), stderr: stderr.trim(), timedOut, cancelled }));
  });
}

export async function dispatchProbe(db, agentId, jobId = null, timeoutMs = 15000) {
  const agent = getAgent(db, agentId); const runId = newId("agent_run"); const started = now();
  db.prepare("INSERT INTO agent_runs VALUES (?, ?, ?, 'probe', 'running', NULL, '', '', ?, NULL)").run(runId, agentId, jobId, started);
  appendEvent(db, "agent_run", runId, "agent_run.started", { agent_id: agentId, mode: "probe" });
  const result = await runCommand(agent.command, [...agent.args, "--version"], { timeoutMs });
  const status = result.timedOut ? "timed_out" : result.exitCode === 0 ? "succeeded" : "failed";
  db.prepare("UPDATE agent_runs SET status=?,exit_code=?,stdout=?,stderr=?,finished_at=? WHERE agent_run_id=?")
    .run(status, result.exitCode, result.stdout, result.stderr, now(), runId);
  appendEvent(db, "agent_run", runId, `agent_run.${status}`, { exit_code: result.exitCode, timed_out: result.timedOut, cancelled: result.cancelled });
  return { agent_run_id: runId, agent_id: agentId, status, ...result };
}

export async function dispatchTextTask(db, agentId, prompt, { jobId = null, timeoutMs = 120000, cwd = process.cwd() } = {}) {
  if (!prompt || typeof prompt !== "string") throw new Error("text task requires a prompt");
  const agent = getAgent(db, agentId); const runId = newId("agent_run"); const started = now();
  db.prepare("INSERT INTO agent_runs VALUES (?, ?, ?, 'text_task', 'running', NULL, '', '', ?, NULL)").run(runId, agentId, jobId, started);
  appendEvent(db, "agent_run", runId, "agent_run.started", { agent_id: agentId, mode: "text_task" });
  const args = agent.args.includes("__PROMPT__")
    ? agent.args.map((arg) => arg === "__PROMPT__" ? prompt : arg.replaceAll("__PROMPT__", prompt))
    : [...agent.args, prompt];
  const cancelCheck = jobId ? () => db.prepare("SELECT status FROM jobs WHERE job_id=?").get(jobId)?.status === "cancel_requested" : null;
  const result = await runCommand(agent.command, args, { timeoutMs, cwd, cancelCheck });
  const status = result.cancelled ? "cancelled" : result.timedOut ? "timed_out" : result.exitCode === 0 ? "succeeded" : "failed";
  db.prepare("UPDATE agent_runs SET status=?,exit_code=?,stdout=?,stderr=?,finished_at=? WHERE agent_run_id=?")
    .run(status, result.exitCode, result.stdout, result.stderr, now(), runId);
  appendEvent(db, "agent_run", runId, `agent_run.${status}`, { exit_code: result.exitCode, timed_out: result.timedOut, cancelled: result.cancelled });
  return { agent_run_id: runId, agent_id: agentId, status, ...result };
}
