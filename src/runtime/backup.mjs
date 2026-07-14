import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { sha256 } from "../core/store.mjs";

function stamp(date) {
  return date.toISOString().replaceAll(":", "").replaceAll("-", "").replace(".", "_");
}

export function createSqliteBackup(db, statePath, backupRoot, { at = new Date() } = {}) {
  mkdirSync(backupRoot, { recursive: true });
  db.exec("PRAGMA wal_checkpoint(FULL)");
  const backupPath = join(backupRoot, "tianshu-" + stamp(at) + ".sqlite");
  copyFileSync(statePath, backupPath);
  const digest = sha256(readFileSync(backupPath));
  const manifestPath = backupPath + ".json";
  writeFileSync(manifestPath, JSON.stringify({
    kind: "tianshu_sqlite_backup",
    source: basename(statePath),
    backup: basename(backupPath),
    created_at: at.toISOString(),
    sha256: digest,
  }, null, 2), "utf8");
  return { backupPath, manifestPath, sha256: digest };
}
export function pruneSqliteBackups(backupRoot, retention = 14) {
  const manifests = readdirSync(backupRoot, { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith(".sqlite.json"))
    .map((item) => item.name)
    .sort()
    .reverse();
  const removed = [];
  for (const manifest of manifests.slice(retention)) {
    const manifestPath = join(backupRoot, manifest);
    const backupPath = manifestPath.slice(0, -5);
    rmSync(manifestPath, { force: true });
    rmSync(backupPath, { force: true });
    removed.push(backupPath);
  }
  return removed;
}
