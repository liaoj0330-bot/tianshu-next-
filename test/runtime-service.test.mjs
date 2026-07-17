import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveRuntimeConfig } from "../src/config/runtime-config.mjs";
import { acquireInstanceLock } from "../src/runtime/instance-lock.mjs";
import { createSqliteBackup, pruneSqliteBackups } from "../src/runtime/backup.mjs";
import { WorkerSupervisor } from "../src/runtime/supervisor.mjs";
import { openStore, sha256 } from "../src/core/store.mjs";
import { enqueueJob } from "../src/runtime/governance.mjs";
import { createGoal, decideApproval, getPlanHash, proposePlan, startRun } from "../src/core/kernel.mjs";
import { createTianShuService } from "../src/app/service.mjs";
import { createReminderAutomation } from "../src/automation/reminders.mjs";

const temp = () => mkdtempSync(join(tmpdir(), "tianshu-m0-"));
const waitFor = async (fn, timeout = 3000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (fn()) return; await new Promise((resolve) => setTimeout(resolve, 20)); }
  throw new Error("condition timeout");
};

test("runtime config has one authoritative state path and rejects accidental remote binding", () => {
  const root = temp();
  const config = resolveRuntimeConfig({ cwd: root, env: {} });
  assert.equal(config.statePath, join(root, ".tianshu-runtime", "state", "tianshu.sqlite"));
  assert.equal(config.maxConcurrency, 2);
  assert.throws(() => resolveRuntimeConfig({ cwd: root, env: { TIANSHU_HOST: "0.0.0.0" } }), /remote binding/);
});

test("instance lock rejects a live owner and recovers a stale owner", () => {
  const lockPath = join(temp(), "service.lock");
  const first = acquireInstanceLock(lockPath);
  assert.throws(() => acquireInstanceLock(lockPath), /already running/);
  first.release();
  const second = acquireInstanceLock(lockPath, { pid: 99999999 });
  second.release();
  assert.equal(existsSync(lockPath), false);
});

test("SQLite backup writes a hash-verified manifest", () => {
  const root = temp(); const statePath = join(root, "state", "tianshu.sqlite");
  const db = openStore(statePath);
  const backup = createSqliteBackup(db, statePath, join(root, "backups"), { at: new Date("2026-07-14T12:00:00.000Z") });
  const manifest = JSON.parse(readFileSync(backup.manifestPath, "utf8"));
  assert.equal(manifest.sha256, sha256(readFileSync(backup.backupPath)));
  db.close();
});

test("backup retention removes the oldest backup and manifest together", () => {
  const root = temp(); const statePath = join(root, "state", "tianshu.sqlite"); const backupRoot = join(root, "backups");
  const db = openStore(statePath);
  for (let day = 1; day <= 3; day += 1) createSqliteBackup(db, statePath, backupRoot, { at: new Date("2026-07-0" + day + "T12:00:00.000Z") });
  const removed = pruneSqliteBackups(backupRoot, 2);
  assert.equal(removed.length, 1); assert.equal(existsSync(removed[0]), false); assert.equal(existsSync(removed[0] + ".json"), false);
  db.close();
});

test("worker supervisor never exceeds configured concurrency", async () => {
  const db = openStore(join(temp(), "state.sqlite"));
  for (let i = 0; i < 4; i += 1) db.prepare("INSERT INTO projects VALUES (?,?,'x','', 'L0','[]',?,?)").run("p" + i, "p" + i, new Date().toISOString(), new Date().toISOString());
  let active = 0; let peak = 0;
  const supervisor = new WorkerSupervisor(db, { maxConcurrency: 2, pollMs: 10, handlers: {
    slow: async () => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 80)); active -= 1; },
  } });
  for (let i = 0; i < 4; i += 1) enqueueJob(db, { projectId: "p" + i, payload: { type: "slow" } });
  supervisor.start();
  await waitFor(() => db.prepare("SELECT count(*) n FROM jobs WHERE status='succeeded'").get().n === 4);
  await supervisor.stop();
  assert.equal(peak, 2);
  db.close();
});

test("service startup reconciles interrupted runs and orphaned job leases", async () => {
  const root = temp();
  const config = { ...resolveRuntimeConfig({ cwd: root, env: { TIANSHU_WORKER_POLL_MS: "20" } }), port: 0 };
  const seed = openStore(config.statePath);
  const goalId = createGoal(seed, { objective: "recover", completion_criteria: ["explicit"] });
  const planId = proposePlan(seed, goalId, { action: "wait", allowed_paths: [] });
  const taskId = decideApproval(seed, planId, "approved", getPlanHash(seed, planId)).taskId;
  const runId = startRun(seed, taskId);
  seed.prepare("INSERT INTO projects VALUES ('p','p','x','', 'L0','[]',?,?)").run(new Date().toISOString(), new Date().toISOString());
  const jobId = enqueueJob(seed, { projectId: "p", payload: { type: "never" } });
  seed.prepare("UPDATE jobs SET status='running',attempts=1,lease_id='old' WHERE job_id=?").run(jobId);
  seed.prepare("INSERT INTO worker_leases VALUES ('old',?,'dead-worker','2999-01-01T00:00:00.000Z','active',?)").run(jobId,new Date().toISOString());
  seed.prepare("INSERT INTO project_locks VALUES ('p',?,'old',?,'2999-01-01T00:00:00.000Z')").run(jobId,new Date().toISOString());
  seed.close();

  const service = await createTianShuService(config, { backupOnStart: false, startWorkers: false });
  assert.deepEqual(service.recoveredRuns, [runId]);
  assert.deepEqual(service.recoveredJobs, [jobId]);
  const health = await fetch("http://" + service.address.address + ":" + service.address.port + "/health").then((response) => response.json());
  assert.equal(health.worker.max_concurrency, 2); assert.equal(health.recovered_runs, 1); assert.equal(health.recovered_jobs, 1);
  assert.equal(service.db.prepare("SELECT status FROM jobs WHERE job_id=?").get(jobId).status, "recovery_required");
  await service.stop();
  assert.equal(existsSync(config.lockPath), false);
});

test("service scheduler materializes a due reminder exactly once", async () => {
  const root = temp();
  const config = { ...resolveRuntimeConfig({ cwd: root, env: { TIANSHU_AUTOMATION_INTERVAL_MS: "10" } }), port: 0 };
  const seed = openStore(config.statePath);
  createReminderAutomation(seed, { title: "恢复后仍会触发", schedule_kind: "once", next_run_at: "2020-01-01T00:00:00.000Z" });
  seed.close();
  const service = await createTianShuService(config, { backupOnStart: false, startWorkers: false });
  try {
    await waitFor(() => service.db.prepare("SELECT COUNT(*) count FROM automation_occurrences").get().count === 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(service.db.prepare("SELECT COUNT(*) count FROM automation_occurrences").get().count, 1);
    const health = await fetch("http://" + service.address.address + ":" + service.address.port + "/health").then((response) => response.json());
    assert.ok(health.automation.last_scan_at);
    assert.equal(health.automation.last_error, null);
  } finally { await service.stop(); }
});
