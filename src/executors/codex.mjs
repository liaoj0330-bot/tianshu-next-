import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { recordExecutorResult } from "../core/kernel.mjs";
import { getOne, recordArtifact } from "../core/store.mjs";

function versionParts(name) {
  const match = name.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return left.localeCompare(right);
}

export function resolveStandaloneCodex(codexHome) {
  const releasesRoot = join(codexHome, "packages", "standalone", "releases");
  if (!existsSync(releasesRoot)) throw new Error("standalone Codex releases directory not found");
  const releases = readdirSync(releasesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersions)
    .reverse();
  for (const release of releases) {
    const root = join(releasesRoot, release);
    const executable = join(root, "bin", "codex.exe");
    const setupHelper = join(root, "codex-resources", "codex-windows-sandbox-setup.exe");
    const commandRunner = join(root, "codex-resources", "codex-command-runner.exe");
    if (existsSync(executable) && existsSync(setupHelper) && existsSync(commandRunner)) {
      return { release, root, executable, setupHelper, commandRunner };
    }
  }
  throw new Error("no complete standalone Codex release found");
}

function inside(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function redact(value) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

function runProcess(executable, args, cwd, timeoutMs) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: null, signal: null, timedOut, stdout, stderr: `${stderr}\n${error.message}`, durationMs: Date.now() - startedAt });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, signal, timedOut, stdout, stderr, durationMs: Date.now() - startedAt });
    });
  });
}

export async function executeCodexRun(db, runId, options) {
  const run = getOne(db, "runs", "run_id", runId);
  if (!run || run.status !== "running") throw new Error("run must be running");
  const repoRoot = resolve(options.repoRoot);
  if (!inside(options.allowedRoot, repoRoot)) throw new Error("repository is outside executor allowed root");
  const artifactRoot = resolve(options.artifactRoot, runId);
  if (!inside(options.allowedRoot, artifactRoot)) throw new Error("artifact directory is outside executor allowed root");
  mkdirSync(artifactRoot, { recursive: true });
  const lastMessagePath = join(artifactRoot, "last-message.txt");
  const args = [
    ...(options.prefixArgs ?? []),
    "exec",
    "--ephemeral",
    "--color", "never",
    "--sandbox", "workspace-write",
    "-C", repoRoot,
    "-c", 'approval_policy="never"',
    "-o", lastMessagePath,
    options.prompt,
  ];
  const processResult = await runProcess(options.executable, args, repoRoot, options.timeoutMs ?? 600_000);
  const stdoutPath = join(artifactRoot, "stdout.log");
  const stderrPath = join(artifactRoot, "stderr.log");
  writeFileSync(stdoutPath, redact(processResult.stdout));
  writeFileSync(stderrPath, redact(processResult.stderr));
  if (!existsSync(lastMessagePath)) writeFileSync(lastMessagePath, "");
  recordArtifact(db, runId, "executor_stdout", stdoutPath);
  recordArtifact(db, runId, "executor_stderr", stderrPath);
  recordArtifact(db, runId, "executor_last_message", lastMessagePath);
  const result = {
    claim: "executor_finished",
    exit_code: processResult.exitCode,
    signal: processResult.signal,
    timed_out: processResult.timedOut,
    duration_ms: processResult.durationMs,
    executable: options.executable,
    release: options.release ?? null,
  };
  recordExecutorResult(db, runId, result);
  return result;
}
