import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

export function acquireInstanceLock(lockPath, { pid = process.pid, startedAt = new Date().toISOString() } = {}) {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, JSON.stringify({ pid, started_at: startedAt }), "utf8");
      closeSync(fd);
      let released = false;
      return {
        lockPath,
        release() {
          if (released) return;
          released = true;
          try {
            const owner = JSON.parse(readFileSync(lockPath, "utf8"));
            if (owner.pid === pid) rmSync(lockPath, { force: true });
          } catch {}
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner = null;
      try { owner = JSON.parse(readFileSync(lockPath, "utf8")); } catch {}
      if (owner && processExists(owner.pid)) throw new Error("TianShu service is already running with pid " + owner.pid);
      rmSync(lockPath, { force: true });
    }
  }
  throw new Error("could not acquire TianShu instance lock");
}