import { resolve } from "node:path";

function positiveInteger(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(label + " must be a positive integer");
  return parsed;
}

export function resolveRuntimeConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const runtimeRoot = resolve(env.TIANSHU_RUNTIME_ROOT ?? resolve(cwd, ".tianshu-runtime"));
  const host = env.TIANSHU_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(host) && env.TIANSHU_ALLOW_REMOTE !== "1") {
    throw new Error("remote binding requires TIANSHU_ALLOW_REMOTE=1");
  }
  return Object.freeze({
    runtimeRoot,
    statePath: resolve(runtimeRoot, "state", "tianshu.sqlite"),
    artifactRoot: resolve(runtimeRoot, "artifacts"),
    backupRoot: resolve(runtimeRoot, "backups"),
    mirrorRoot: resolve(runtimeRoot, "mirror"),
    lockPath: resolve(runtimeRoot, "service.lock"),
    host,
    port: positiveInteger(env.TIANSHU_PORT, 4317, "TIANSHU_PORT"),
    maxConcurrency: positiveInteger(env.TIANSHU_MAX_CONCURRENCY, 2, "TIANSHU_MAX_CONCURRENCY"),
    pollMs: positiveInteger(env.TIANSHU_WORKER_POLL_MS, 250, "TIANSHU_WORKER_POLL_MS"),
    leaseMs: positiveInteger(env.TIANSHU_LEASE_MS, 30000, "TIANSHU_LEASE_MS"),
    backupIntervalMs: positiveInteger(env.TIANSHU_BACKUP_INTERVAL_MS, 86400000, "TIANSHU_BACKUP_INTERVAL_MS"),
    backupRetention: positiveInteger(env.TIANSHU_BACKUP_RETENTION, 14, "TIANSHU_BACKUP_RETENTION"),
    automationIntervalMs: positiveInteger(env.TIANSHU_AUTOMATION_INTERVAL_MS, 1000, "TIANSHU_AUTOMATION_INTERVAL_MS"),
  });
}
