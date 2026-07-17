import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import {
  claimJob,
  enqueueJob,
  finishJob,
  reconcileOrphanedLeases,
  startJob,
} from "../src/runtime/governance.mjs";

async function request(base, path, body) {
  const response = await fetch(base + path, body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("only the local creator can cancel, retry, and recover asynchronous jobs through the cockpit gateway", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-job-control-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  try {
    const address = await gateway.listen();
    const base = `http://${address.address}:${address.port}`;

    const queuedId = enqueueJob(db, { projectId: "tianshu-next", payload: { action: "bounded preview" } });
    const missingActor = await request(base, `/v1/jobs/${queuedId}/cancel`, {});
    assert.equal(missingActor.status, 400);
    assert.match(missingActor.body.error, /identified principal/);
    const deniedCancel = await request(base, `/v1/jobs/${queuedId}/cancel`, { decided_by: "agenthub" });
    assert.equal(deniedCancel.status, 400);
    assert.match(deniedCancel.body.error, /not authorized for execution\.approve/);
    assert.equal(db.prepare("SELECT status FROM jobs WHERE job_id=?").get(queuedId).status, "queued");
    const cancelled = await request(base, `/v1/jobs/${queuedId}/cancel`, { decided_by: "nainai" });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, "cancelled");

    const failedId = enqueueJob(db, {
      projectId: "tianshu-next",
      payload: { action: "retry evidence" },
      maxAttempts: 1,
    });
    const failedLease = claimJob(db, "worker-1");
    assert.equal(failedLease.job_id, failedId);
    startJob(db, failedId, failedLease.lease_id);
    assert.equal(finishJob(db, failedId, "failed", { code: "preview_failure" }), "failed");
    const deniedRetry = await request(base, `/v1/jobs/${failedId}/retry`, { decided_by: "agenthub" });
    assert.equal(deniedRetry.status, 400);
    assert.equal(db.prepare("SELECT status FROM jobs WHERE job_id=?").get(failedId).status, "failed");
    const retried = await request(base, `/v1/jobs/${failedId}/retry`, { decided_by: "nainai" });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.job.status, "queued");
    assert.equal(retried.body.job.max_attempts, 2);
    await request(base, `/v1/jobs/${failedId}/cancel`, { decided_by: "nainai" });

    const recoveryId = enqueueJob(db, {
      projectId: "tianshu-next",
      payload: { action: "recover after restart" },
      maxAttempts: 2,
    });
    const recoveryLease = claimJob(db, "worker-2");
    assert.equal(recoveryLease.job_id, recoveryId);
    startJob(db, recoveryId, recoveryLease.lease_id);
    assert.deepEqual(reconcileOrphanedLeases(db), [recoveryId]);
    const jobs = await request(base, "/v1/jobs");
    assert.equal(jobs.status, 200);
    assert.equal(jobs.body.state_authority, "sqlite");
    assert.equal(jobs.body.decision_authority, "local_creator");
    const recoverable = jobs.body.items.find((item) => item.job_id === recoveryId);
    assert.equal(recoverable.status, "recovery_required");
    assert.equal(recoverable.can_retry, true);
    assert.equal(recoverable.can_cancel, true);
    const recovered = await request(base, `/v1/jobs/${recoveryId}/retry`, { decided_by: "nainai" });
    assert.equal(recovered.body.job.status, "queued");
    assert.ok(db.prepare("SELECT 1 FROM events WHERE entity_id=? AND event_type='job.creator_retry_queued'").get(recoveryId));
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
