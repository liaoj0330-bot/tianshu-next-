import { resolve } from "node:path";
import { openStore } from "../src/core/store.mjs";
import { applyLegacyContextMigration, planLegacyContextMigration } from "../src/product/legacy-context-classifier.mjs";

const args = process.argv.slice(2);
const stateIndex = args.indexOf("--state");
if (stateIndex < 0 || !args[stateIndex + 1]) throw new Error("--state <sqlite-path> is required");
const statePath = resolve(args[stateIndex + 1]);
const apply = args.includes("--apply");
const db = openStore(statePath);
try {
  const proposals = planLegacyContextMigration(db);
  const result = apply ? applyLegacyContextMigration(db, proposals) : [];
  console.log(JSON.stringify({ state_path: statePath, mode: apply ? "apply" : "dry_run", proposal_count: proposals.length, applied_count: result.length, proposals }, null, 2));
} finally {
  db.close();
}
