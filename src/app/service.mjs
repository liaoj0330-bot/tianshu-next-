import { mkdirSync } from "node:fs";
import { createGateway } from "../gateway/server.mjs";
import { openStore } from "../core/store.mjs";
import { reconcileInterruptedRuns } from "../core/kernel.mjs";
import { reconcileOrphanedLeases } from "../runtime/governance.mjs";
import { acquireInstanceLock } from "../runtime/instance-lock.mjs";
import { createSqliteBackup, pruneSqliteBackups } from "../runtime/backup.mjs";
import { WorkerSupervisor } from "../runtime/supervisor.mjs";
import { scanRegisteredProjectChanges } from "../creator/project-observer.mjs";
import { executeManagedTaskJob } from "../orchestration/managed-job.mjs";
import { runDueAutomations } from "../automation/reminders.mjs";

export async function createTianShuService(config, { handlers = {}, backupOnStart = true, startWorkers = true } = {}) {
  mkdirSync(config.runtimeRoot, { recursive: true });
  const lock = acquireInstanceLock(config.lockPath);
  let db;
  let gateway;
  let supervisor;
  let backupTimer;
  let observationTimer;
  let automationTimer;
  let observationStatus = { last_scan_at: null, last_result: null, last_error: null };
  let automationStatus = { last_scan_at: null, fired: 0, last_error: null };
  try {
    db = openStore(config.statePath);
    const recoveredRuns = reconcileInterruptedRuns(db);
    const recoveredJobs = reconcileOrphanedLeases(db);
    let lastBackup = backupOnStart ? createSqliteBackup(db, config.statePath, config.backupRoot) : null;
    if (backupOnStart) pruneSqliteBackups(config.backupRoot, config.backupRetention);

    gateway = createGateway({
      db,
      host: config.host,
      port: config.port,
      health: () => ({
        pid: process.pid,
        uptime_seconds: Math.floor(process.uptime()),
        worker: supervisor?.status() ?? { running: false, active: 0, max_concurrency: config.maxConcurrency },
        recovered_runs: recoveredRuns.length,
        recovered_jobs: recoveredJobs.length,
        last_backup_sha256: lastBackup?.sha256 ?? null,
        observation: observationStatus,
        automation: automationStatus,
      }),
    });
    const address = await gateway.listen();
    supervisor = new WorkerSupervisor(db, {
      maxConcurrency: config.maxConcurrency,
      pollMs: config.pollMs,
      leaseMs: config.leaseMs,
      handlers: { managed_execution: executeManagedTaskJob, ...handlers },
    });
    if (startWorkers) supervisor.start();

    backupTimer = setInterval(() => {
      lastBackup = createSqliteBackup(db, config.statePath, config.backupRoot);
      pruneSqliteBackups(config.backupRoot, config.backupRetention);
    }, config.backupIntervalMs);
    backupTimer.unref?.();
    const observationIntervalMs = config.observationIntervalMs ?? 15000;
    observationTimer = setInterval(() => {
      try { observationStatus = { last_scan_at: new Date().toISOString(), last_result: scanRegisteredProjectChanges(db), last_error: null }; }
      catch (error) { observationStatus = { last_scan_at: new Date().toISOString(), last_result: null, last_error: error.message }; }
    }, observationIntervalMs);
    observationTimer.unref?.();
    const scanAutomations = () => {
      try { const fired = runDueAutomations(db); automationStatus = { last_scan_at: new Date().toISOString(), fired: fired.length, last_error: null }; }
      catch (error) { automationStatus = { last_scan_at: new Date().toISOString(), fired: 0, last_error: error.message }; }
    };
    scanAutomations();
    automationTimer = setInterval(scanAutomations, config.automationIntervalMs);
    automationTimer.unref?.();

    let stopped = false;
    return {
      config, db, address, recoveredRuns, recoveredJobs, supervisor,
      async stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(backupTimer);
        clearInterval(observationTimer);
        clearInterval(automationTimer);
        await supervisor.stop();
        await gateway.close();
        db.close();
        lock.release();
      },
    };
  } catch (error) {
    clearInterval(backupTimer);
    clearInterval(observationTimer);
    clearInterval(automationTimer);
    try { await supervisor?.stop(); } catch {}
    try { await gateway?.close(); } catch {}
    try { db?.close(); } catch {}
    lock.release();
    throw error;
  }
}
