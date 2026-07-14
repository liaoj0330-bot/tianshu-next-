import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { buildResumePacket, closeTurn, recordProblemCase } from "../src/continuity/continuity.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import { writeContinuityMirrors } from "../src/writeback/continuity.mjs";

const checkpoint = {
  scope: "tianshu",
  objective: "完成 P5 真实隔离任务验收",
  phase: "P5-real-task-acceptance",
  completed: ["双确认治理"],
  in_progress: ["跨 Agent 独立复核"],
  blockers: ["复核链路稳定性"],
  next_action: "执行一个仓库内隔离代码任务",
  evidence: ["75/75 tests"],
  repositories: [{ path: "D:\\AI_Workspace\\tianshu-next-", branch: "main", head: "65e01e1" }],
  services: [{ name: "tianshu", status: "ok" }],
  protected_boundaries: ["Teacher PPT", "069", "070"],
  acceptance_state: "in_progress",
};

const problem = {
  fingerprint: "executor-zero-no-change",
  title: "Executor 假成功",
  symptom: "退出码为 0，但没有产生要求的实际修改",
  root_cause: "把进程成功错误地当成任务成功",
  resolution: "检查 Git diff、预期内容、允许路径和独立复核证据",
  recurrence_playbook: "先检查实际文件与 Git，再读取模型总结",
  validation: ["exit code zero without required change fails verification"],
  status: "monitoring",
};

test("turn closure persists a resumable packet, problems, lessons, and content ideas without starting execution", () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-continuity-")); const dbPath = join(root, "state.sqlite");
  let db = openStore(dbPath);
  const result = closeTurn(db, {
    source: { kind: "conversation", reference: "2026-07-15" }, checkpoint,
    problems: [problem],
    evolution_candidates: [
      { kind: "operational_rule", title: "完成必须有独立证据", payload: { rule: "executor cannot self-verify", requires_creator_confirmation: true } },
      { kind: "content_idea", title: "AI 说完成了，项目为什么仍然不能运行", payload: { formats: ["公众号", "口播"], source_problem: "executor-zero-no-change" } },
    ],
  });
  assert.equal(result.execution_started, false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM runs").get().count, 0);
  db.close();

  db = openStore(dbPath);
  const resume = buildResumePacket(db, "tianshu");
  assert.equal(resume.can_resume, true);
  assert.equal(resume.checkpoint.snapshot.next_action, checkpoint.next_action);
  assert.equal(resume.unresolved_problems[0].fingerprint, problem.fingerprint);
  assert.equal(resume.evolution_candidates.length, 2);
  assert.match(resume.resume_instruction, /不重新规划已完成工作/);
  db.close(); rmSync(root, { recursive: true, force: true });
});

test("a recurring problem increments occurrence count instead of creating duplicate memory", () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-problem-")); const db = openStore(join(root, "state.sqlite"));
  recordProblemCase(db, problem); recordProblemCase(db, { ...problem, symptom: "另一次执行仍然退出成功但没有变更" });
  const rows = db.prepare("SELECT fingerprint,occurrence_count FROM problem_cases").all();
  assert.equal(rows.length, 1); assert.equal(rows[0].occurrence_count, 2);
  db.close(); rmSync(root, { recursive: true, force: true });
});

test("resume API restores the same SQLite checkpoint after gateway restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-resume-api-")); const dbPath = join(root, "state.sqlite");
  let db = openStore(dbPath); let gateway = createGateway({ db }); let address = await gateway.listen();
  const base = `http://${address.address}:${address.port}`;
  const closed = await fetch(`${base}/v1/continuity/close-turn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checkpoint, problems: [problem], evolution_candidates: [] }) });
  assert.equal(closed.status, 201); await gateway.close(); db.close();

  db = openStore(dbPath); gateway = createGateway({ db }); address = await gateway.listen();
  const resumed = await fetch(`http://${address.address}:${address.port}/v1/continuity/resume?scope=tianshu`).then((response) => response.json());
  assert.equal(resumed.state_authority, "sqlite"); assert.equal(resumed.can_resume, true); assert.equal(resumed.checkpoint.phase, checkpoint.phase); assert.equal(resumed.unresolved_problems.length, 1);
  await gateway.close(); db.close(); rmSync(root, { recursive: true, force: true });
});
test("continuity writeback renders resumable Obsidian mirrors from SQLite", () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-continuity-mirror-")); const db = openStore(join(root, "state.sqlite"));
  closeTurn(db, { checkpoint, problems: [problem], evolution_candidates: [{ kind: "content_idea", title: "退出码成功为什么仍可能是假成功", payload: { formats: ["公众号"] } }] });
  const paths = { resumePath: join(root, "resume.md"), problemsPath: join(root, "problems.md"), contentPath: join(root, "content.md") };
  writeContinuityMirrors(db, paths);
  const resume = readFileSync(paths.resumePath, "utf8"); const problems = readFileSync(paths.problemsPath, "utf8"); const content = readFileSync(paths.contentPath, "utf8");
  assert.match(resume, /执行一个仓库内隔离代码任务/); assert.match(resume, /state_authority: sqlite/); assert.match(problems, /Executor 假成功/); assert.match(content, /退出码成功为什么仍可能是假成功/); assert.match(content, /候选不等于已经批准发布/);
  db.close(); rmSync(root, { recursive: true, force: true });
});
test("turn closure is atomic when a later evolution candidate is invalid", () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-continuity-rollback-")); const db = openStore(join(root, "state.sqlite"));
  assert.throws(() => closeTurn(db, { checkpoint, problems: [problem], evolution_candidates: [{ kind: "invalid", title: "bad" }] }), /invalid evolution candidate kind/);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM problem_cases").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM evolution_candidates").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM continuation_checkpoints").get().count, 0);
  db.close(); rmSync(root, { recursive: true, force: true });
});