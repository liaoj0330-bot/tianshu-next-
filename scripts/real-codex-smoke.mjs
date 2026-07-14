import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createGoal,
  decideApproval,
  decideRun,
  getPlanHash,
  proposePlan,
  startRun,
} from "../src/core/kernel.mjs";
import { getOne, openStore } from "../src/core/store.mjs";
import { executeCodexRun, resolveStandaloneCodex } from "../src/executors/codex.mjs";
import { verifyGitRun } from "../src/verification/git-verifier.mjs";

const root = resolve(".real-smoke");
const repoRoot = join(root, "repo");
const artifactRoot = join(root, "artifacts");
const statePath = join(root, "state", "tianshu-next.sqlite");
const expected = "tianshu next real executor verified.\n";

rmSync(root, { recursive: true, force: true });
mkdirSync(repoRoot, { recursive: true });
writeFileSync(join(repoRoot, "AGENTS.md"), [
  "# Disposable TianShu Next real executor test",
  "",
  "- Modify only fixture.txt.",
  "- Do not create, delete, rename, or modify any other file.",
  "- Do not commit.",
  "",
].join("\n"));
writeFileSync(join(repoRoot, "fixture.txt"), "before\n");
execFileSync("git", ["init"], { cwd: repoRoot, windowsHide: true });
execFileSync("git", ["add", "AGENTS.md", "fixture.txt"], { cwd: repoRoot, windowsHide: true });
execFileSync("git", [
  "-c", "user.name=TianShu-Next",
  "-c", "user.email=next@localhost",
  "commit", "-m", "baseline",
], { cwd: repoRoot, windowsHide: true });

const db = openStore(statePath);
const goalId = createGoal(db, {
  objective: "Prove the real Codex executor can produce one independently verified candidate.",
  completion_criteria: [
    "only fixture.txt changes",
    "fixture.txt has exact expected bytes",
    "Git diff check passes",
    "creator gate accepts independent evidence",
  ],
});
const prompt = [
  "Modify only fixture.txt.",
  "Replace its entire contents with the literal line shown between markers.",
  "Do not include the markers themselves.",
  "<BEGIN>tianshu next real executor verified.<END>",
  "The period immediately before <END> is part of the required file content.",
  "End the file with one newline.",
  "Do not create or modify any other file. Do not commit. After editing, stop.",
].join(" ");
const planId = proposePlan(db, goalId, {
  action: "codex_edit",
  allowed_paths: ["fixture.txt"],
  expected_files: {
    "fixture.txt": {
      content: expected,
      newline_policy: "lf_or_crlf",
    },
  },
  prompt,
  repository_root: repoRoot,
});
const { approvalId, taskId } = decideApproval(db, planId, "approved", getPlanHash(db, planId));
const runId = startRun(db, taskId);
const codex = resolveStandaloneCodex(join(process.env.USERPROFILE, ".codex"));
const execution = await executeCodexRun(db, runId, {
  allowedRoot: root,
  artifactRoot,
  executable: codex.executable,
  prompt,
  repoRoot,
  release: codex.release,
  timeoutMs: 600_000,
});
const verification = verifyGitRun(db, runId, repoRoot, artifactRoot);
let decisionId = null;
if (verification.passed) {
  decisionId = decideRun(db, runId, "accept", "Independent Git and byte-level evidence passed.");
} else {
  decisionId = decideRun(db, runId, "reject", "Independent verification failed.");
}
const artifacts = db.prepare(`SELECT kind, path, sha256, size_bytes FROM artifacts WHERE run_id = ? ORDER BY kind`).all(runId);
const report = {
  generated_at: new Date().toISOString(),
  goal_id: goalId,
  plan_id: planId,
  approval_id: approvalId,
  task_id: taskId,
  run_id: runId,
  decision_id: decisionId,
  codex_release: codex.release,
  execution,
  verification,
  final_goal_status: getOne(db, "goals", "goal_id", goalId).status,
  final_run_status: getOne(db, "runs", "run_id", runId).status,
  actual_fixture: readFileSync(join(repoRoot, "fixture.txt"), "utf8"),
  artifacts,
};
const reportPath = join(root, "REAL_CODEX_SMOKE_REPORT_001.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));
db.close();
console.log(JSON.stringify({ report_path: reportPath, ...report }, null, 2));
