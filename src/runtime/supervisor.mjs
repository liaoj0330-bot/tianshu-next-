import { claimJob, finishJob, startJob } from "./governance.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class WorkerSupervisor {
  constructor(db, { maxConcurrency = 2, pollMs = 250, leaseMs = 30000, workerId = "tianshu-worker", handlers = {} } = {}) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) throw new Error("maxConcurrency must be positive");
    this.db = db;
    this.maxConcurrency = maxConcurrency;
    this.pollMs = pollMs;
    this.leaseMs = leaseMs;
    this.workerId = workerId;
    this.handlers = new Map(Object.entries(handlers));
    this.active = new Set();
    this.running = false;
    this.loopPromise = null;
  }

  status() {
    return { running: this.running, active: this.active.size, max_concurrency: this.maxConcurrency, worker_id: this.workerId };
  }

  register(type, handler) {
    if (!type || typeof handler !== "function") throw new Error("worker handler requires type and function");
    this.handlers.set(type, handler);
  }

  async execute(job) {
    startJob(this.db, job.job_id, job.lease_id);
    const payload = JSON.parse(job.payload_json);
    const handler = this.handlers.get(payload.type);
    if (!handler) {
      finishJob(this.db, job.job_id, "failed", { code: "unknown_job_type", type: payload.type ?? null });
      return;
    }
    try {
      await handler({ job, payload, db: this.db });
      finishJob(this.db, job.job_id, "succeeded");
    } catch (error) {
      finishJob(this.db, job.job_id, error?.code === "ETIMEDOUT" ? "timed_out" : "failed", {
        code: error?.code === "ETIMEDOUT" ? "timeout" : "handler_failed",
        message: String(error?.message ?? error),
      });
    }
  }

  launch(job) {
    const promise = this.execute(job).finally(() => this.active.delete(promise));
    this.active.add(promise);
  }

  async loop() {
    while (this.running) {
      let claimed = false;
      while (this.running && this.active.size < this.maxConcurrency) {
        const job = claimJob(this.db, this.workerId + "-" + (this.active.size + 1), this.leaseMs);
        if (!job) break;
        claimed = true;
        this.launch(job);
      }
      if (!claimed) await wait(this.pollMs);
    }
    await Promise.allSettled([...this.active]);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop() {
    this.running = false;
    await this.loopPromise;
  }
}