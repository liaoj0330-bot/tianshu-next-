import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyRun } from "../core/kernel.mjs";
import { getOne, recordArtifact } from "../core/store.mjs";

function git(repoRoot, args) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", windowsHide: true });
}

function loadPlan(db, runId) {
  return db.prepare(`
    SELECT p.plan_json
    FROM runs r
    JOIN tasks t ON t.task_id = r.task_id
    JOIN plans p ON p.plan_id = t.plan_id
    WHERE r.run_id = ?
  `).get(runId);
}

function contentMatches(actual, expectedSpec) {
  if (typeof expectedSpec === "string") {
    return { matches: actual === expectedSpec, expected: expectedSpec, newline_policy: "exact_bytes" };
  }
  const expected = expectedSpec.content;
  const newlinePolicy = expectedSpec.newline_policy ?? "exact_bytes";
  if (newlinePolicy === "lf_or_crlf") {
    return {
      matches: actual.replaceAll("\r\n", "\n") === expected.replaceAll("\r\n", "\n"),
      expected,
      newline_policy: newlinePolicy,
    };
  }
  return { matches: actual === expected, expected, newline_policy: newlinePolicy };
}

export function verifyGitRun(db, runId, repoRoot, artifactRoot) {
  const run = getOne(db, "runs", "run_id", runId);
  if (!run || run.status !== "awaiting_verification") throw new Error("run is not awaiting verification");
  const plan = JSON.parse(loadPlan(db, runId).plan_json);
  const changedResult = git(repoRoot, ["diff", "--name-only"]);
  const untrackedResult = git(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
  const checkResult = git(repoRoot, ["diff", "--check"]);
  const changedPaths = [...new Set([
    ...changedResult.stdout.split(/\r?\n/).filter(Boolean),
    ...untrackedResult.stdout.split(/\r?\n/).filter(Boolean),
  ])].sort();
  const allowedPaths = [...plan.allowed_paths].sort();
  const unexpectedPaths = changedPaths.filter((path) => !allowedPaths.includes(path));
  const missingExpectedPaths = Object.keys(plan.expected_files ?? {})
    .filter((path) => !changedPaths.includes(path));
  const contentMismatches = [];
  for (const [path, expectedSpec] of Object.entries(plan.expected_files ?? {})) {
    const actual = readFileSync(resolve(repoRoot, path), "utf8");
    const comparison = contentMatches(actual, expectedSpec);
    if (!comparison.matches) {
      contentMismatches.push({
        path,
        expected: comparison.expected,
        actual,
        newline_policy: comparison.newline_policy,
      });
    }
  }
  const executorResult = JSON.parse(run.executor_result_json);
  const passed = executorResult.exit_code === 0
    && !executorResult.timed_out
    && changedResult.status === 0
    && untrackedResult.status === 0
    && checkResult.status === 0
    && unexpectedPaths.length === 0
    && missingExpectedPaths.length === 0
    && contentMismatches.length === 0;
  const report = {
    passed,
    executor_exit_code: executorResult.exit_code,
    executor_timed_out: executorResult.timed_out,
    changed_paths: changedPaths,
    allowed_paths: allowedPaths,
    unexpected_paths: unexpectedPaths,
    missing_expected_paths: missingExpectedPaths,
    content_mismatches: contentMismatches,
    git_diff_check_exit_code: checkResult.status,
  };
  const runArtifactRoot = resolve(artifactRoot, runId);
  mkdirSync(runArtifactRoot, { recursive: true });
  const reportPath = join(runArtifactRoot, "verification-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  recordArtifact(db, runId, "verification_report", reportPath);
  verifyRun(db, runId, passed, report, "git_independent_verifier");
  return report;
}
