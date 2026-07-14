import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, test } from "node:test";
import {
  createGoal,
  decideApproval,
  decideRun,
  getPlanHash,
  proposePlan,
  startRun,
} from "../src/core/kernel.mjs";
import { getOne, openStore, sha256 } from "../src/core/store.mjs";
import { executeCodexRun, resolveStandaloneCodex } from "../src/executors/codex.mjs";
import { verifyGitRun } from "../src/verification/git-verifier.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");
const runtime = resolve(".executor-test-runtime");
let db;

function git(repoRoot, ...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", windowsHide: true });
}

function createRepo(name) {
  const repoRoot = join(runtime, name);
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(join(repoRoot, "fixture.txt"), "before\n");
  git(repoRoot, "init");
  git(repoRoot, "add", "fixture.txt");
  git(repoRoot, "-c", "user.name=TianShu-Test", "-c", "user.email=test@localhost", "commit", "-m", "baseline");
  return repoRoot;
}

function approvedRun(repoRoot, mode, expectedSpec = "codex adapter verified\n") {
  const goalId = createGoal(db, {
    objective: `Validate Codex adapter ${mode}`,
    completion_criteria: ["fixture content matches", "no unexpected paths", "creator accepts"],
  });
  const planId = proposePlan(db, goalId, {
    action: "codex_edit",
    allowed_paths: ["fixture.txt"],
    expected_files: { "fixture.txt": expectedSpec },
    prompt: mode,
    repository_root: repoRoot,
  });
  const { taskId } = decideApproval(db, planId, "approved", getPlanHash(db, planId));
  return { goalId, runId: startRun(db, taskId) };
}

async function executeAndVerify(name, mode, expectedSpec) {
  const repoRoot = createRepo(name);
  const state = approvedRun(repoRoot, mode, expectedSpec);
  const execution = await executeCodexRun(db, state.runId, {
    allowedRoot: runtime,
    artifactRoot: join(runtime, "artifacts"),
    executable: process.execPath,
    prefixArgs: [fakeCodex],
    prompt: mode,
    timeoutMs: 10_000,
    repoRoot,
    release: "fake-test",
  });
  const verification = verifyGitRun(db, state.runId, repoRoot, join(runtime, "artifacts"));
  return { ...state, repoRoot, execution, verification };
}

beforeEach(() => {
  db?.close();
  rmSync(runtime, { recursive: true, force: true });
  db = openStore(join(runtime, "state", "executor.sqlite"));
});

test("standalone resolver selects the newest complete release", () => {
  const home = join(runtime, "codex-home");
  for (const version of ["0.143.0-x86_64-pc-windows-msvc", "0.144.1-x86_64-pc-windows-msvc"]) {
    const root = join(home, "packages", "standalone", "releases", version);
    mkdirSync(join(root, "bin"), { recursive: true });
    mkdirSync(join(root, "codex-resources"), { recursive: true });
    writeFileSync(join(root, "bin", "codex.exe"), "");
    writeFileSync(join(root, "codex-resources", "codex-windows-sandbox-setup.exe"), "");
    writeFileSync(join(root, "codex-resources", "codex-command-runner.exe"), "");
  }
  assert.match(resolveStandaloneCodex(home).release, /^0\.144\.1/);
});

test("successful executor output still requires Git and content verification", async () => {
  const result = await executeAndVerify("success-repo", "success");
  assert.equal(result.execution.exit_code, 0);
  assert.equal(result.verification.passed, true);
  assert.deepEqual(result.verification.changed_paths, ["fixture.txt"]);
  assert.equal(getOne(db, "goals", "goal_id", result.goalId).status, "awaiting_creator_decision");
  decideRun(db, result.runId, "accept", "Independent Git evidence passed.");
  assert.equal(getOne(db, "goals", "goal_id", result.goalId).status, "completed");
});

test("exit code zero without the required change fails verification", async () => {
  const result = await executeAndVerify("no-change-repo", "no_change");
  assert.equal(result.execution.exit_code, 0);
  assert.equal(result.verification.passed, false);
  assert.deepEqual(result.verification.missing_expected_paths, ["fixture.txt"]);
  assert.throws(() => decideRun(db, result.runId, "accept", "trust exit code"), /only an independently verified/);
});

test("an unexpected path fails verification even when expected content is correct", async () => {
  const result = await executeAndVerify("scope-repo", "scope_violation");
  assert.equal(result.execution.exit_code, 0);
  assert.equal(result.verification.passed, false);
  assert.deepEqual(result.verification.unexpected_paths, ["outside.txt"]);
});

test("CRLF is accepted only when the approved plan declares a compatible newline policy", async () => {
  const result = await executeAndVerify("crlf-repo", "crlf_success", {
    content: "codex adapter verified\n",
    newline_policy: "lf_or_crlf",
  });
  assert.equal(result.verification.passed, true);
});

test("executor and verification artifacts are hash-addressed", async () => {
  const result = await executeAndVerify("artifact-repo", "success");
  const artifacts = db.prepare(`SELECT * FROM artifacts WHERE run_id = ? ORDER BY kind`).all(result.runId);
  assert.equal(artifacts.length, 4);
  for (const artifact of artifacts) {
    assert.equal(sha256(readFileSync(artifact.path)), artifact.sha256);
  }
});
