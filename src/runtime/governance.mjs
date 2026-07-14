import { randomUUID } from "node:crypto";
import { appendEvent, canonicalJson, newId, now } from "../core/store.mjs";

const iso = (ms) => new Date(Date.now() + ms).toISOString();

function tx(db, fn) { db.exec("BEGIN IMMEDIATE"); try { const out = fn(); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } }

export function enqueueJob(db, { projectId, payload = {}, maxAttempts = 1, availableAt = now() }) {
  if (!projectId || maxAttempts < 1) throw new Error("job requires projectId and positive maxAttempts");
  const jobId = newId("job");
  tx(db, () => { db.prepare("INSERT INTO jobs VALUES (?, ?, ?, 'queued', 0, ?, ?, NULL, ?, ?)")
    .run(jobId, projectId, canonicalJson(payload), maxAttempts, availableAt, now(), now());
    appendEvent(db, "job", jobId, "job.queued", { project_id: projectId }); });
  return jobId;
}

export function claimJob(db, workerId, leaseMs = 30000) {
  const job = db.prepare("SELECT * FROM jobs WHERE status IN ('queued','retry_wait','recovery_required') AND available_at <= ? ORDER BY created_at LIMIT 1").get(now());
  if (!job) return null;
  const leaseId = `lease_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const expires = iso(leaseMs);
  return tx(db, () => {
    const lock = db.prepare("SELECT * FROM project_locks WHERE project_id = ? AND expires_at > ?").get(job.project_id, now());
    if (lock) return null;
    const current = db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(job.job_id);
    if (!current || !["queued", "retry_wait", "recovery_required"].includes(current.status)) return null;
    db.prepare("INSERT INTO worker_leases VALUES (?, ?, ?, ?, 'active', ?)").run(leaseId, job.job_id, workerId, expires, now());
    db.prepare("INSERT INTO project_locks VALUES (?, ?, ?, ?, ?)").run(job.project_id, job.job_id, leaseId, now(), expires);
    db.prepare("UPDATE jobs SET status='leased', attempts=attempts+1, lease_id=?, updated_at=? WHERE job_id=?").run(leaseId, now(), job.job_id);
    appendEvent(db, "job", job.job_id, "job.leased", { worker_id: workerId, lease_id: leaseId });
    return { ...job, lease_id: leaseId, worker_id: workerId, expires_at: expires, attempts: current.attempts + 1 };
  });
}

export function startJob(db, jobId, leaseId) {
  return tx(db, () => { const job = db.prepare("SELECT * FROM jobs WHERE job_id=? AND lease_id=?").get(jobId, leaseId); if (!job || job.status !== "leased") throw new Error("job lease is not valid"); db.prepare("UPDATE jobs SET status='running',updated_at=? WHERE job_id=?").run(now(), jobId); appendEvent(db,"job",jobId,"job.started",{}); return jobId; });
}

export function requestCancel(db, jobId) {
  const job = db.prepare("SELECT * FROM jobs WHERE job_id=?").get(jobId); if (!job) throw new Error("unknown job");
  const status = ["queued", "retry_wait"].includes(job.status) ? "cancelled" : "cancel_requested";
  db.prepare("UPDATE jobs SET status=?,updated_at=? WHERE job_id=?").run(status, now(), jobId); appendEvent(db,"job",jobId,`job.${status}`,{}); return status;
}

export function finishJob(db, jobId, outcome, detail = {}) {
  const job = db.prepare("SELECT * FROM jobs WHERE job_id=?").get(jobId); if (!job) throw new Error("unknown job");
  return tx(db, () => { const success = outcome === "succeeded"; const cancelled = outcome === "cancelled" || job.status === "cancel_requested"; const next = success ? "succeeded" : cancelled ? "cancelled" : (job.attempts < job.max_attempts ? "retry_wait" : "failed"); db.prepare("UPDATE jobs SET status=?,available_at=?,updated_at=? WHERE job_id=?").run(next, success || cancelled ? now() : iso(detail.retry_delay_ms ?? 100), now(), jobId); if (job.lease_id) { db.prepare("UPDATE worker_leases SET status='released' WHERE lease_id=?").run(job.lease_id); db.prepare("DELETE FROM project_locks WHERE lease_id=?").run(job.lease_id); } if (!success && !cancelled) db.prepare("INSERT INTO failure_cases VALUES (?, ?, ?, ?, ?, ?)").run(newId("failure"), jobId, job.project_id, detail.code ?? (outcome === "timed_out" ? "timeout" : "execution_failed"), canonicalJson(detail), now()); appendEvent(db,"job",jobId,"job."+next,{...detail,outcome}); return next; });
}

export function reconcileLeases(db) {
  const expired = db.prepare("SELECT * FROM worker_leases WHERE status='active' AND expires_at <= ?").all(now());
  return tx(db, () => { for (const lease of expired) { db.prepare("UPDATE worker_leases SET status='expired' WHERE lease_id=?").run(lease.lease_id); db.prepare("DELETE FROM project_locks WHERE lease_id=?").run(lease.lease_id); db.prepare("UPDATE jobs SET status='recovery_required',lease_id=NULL,updated_at=? WHERE job_id=? AND status IN ('leased','running')").run(now(), lease.job_id); appendEvent(db,"job",lease.job_id,"job.recovery_required",{lease_id:lease.lease_id}); } return expired.map((x) => x.job_id); });
}
