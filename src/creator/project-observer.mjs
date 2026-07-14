import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { now } from "../core/store.mjs";
import { proposeProjectChange } from "./project-changes.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

export function scanRegisteredProjectChanges(db, { git = spawnSync } = {}) {
  const projects = db.prepare("SELECT p.project_id,p.name,p.root_path,c.execution_policy FROM projects p JOIN creator_project_profiles c ON c.project_key=p.project_id WHERE c.execution_policy!='no_access' ORDER BY p.project_id").all();
  const results = [];
  for (const project of projects) {
    const result = git("git", ["status", "--porcelain=v1", "--untracked-files=normal"], { cwd: project.root_path, encoding: "utf8", timeout: 10000, windowsHide: true });
    if (result.status !== 0) { results.push({ project_key: project.project_id, status: "probe_failed", error: String(result.stderr || "git status failed").trim() }); continue; }
    const normalized = String(result.stdout ?? "").replaceAll("\r\n", "\n").trim();
    const fingerprint = hash(normalized);
    const previous = db.prepare("SELECT fingerprint FROM project_observation_cursors WHERE project_key=? AND source_kind='git_status'").get(project.project_id);
    db.prepare("INSERT INTO project_observation_cursors VALUES (?, 'git_status', ?, ?) ON CONFLICT(project_key,source_kind) DO UPDATE SET fingerprint=excluded.fingerprint,observed_at=excluded.observed_at").run(project.project_id, fingerprint, now());
    if (!previous) { results.push({ project_key: project.project_id, status: "baseline_recorded", fingerprint }); continue; }
    if (previous.fingerprint === fingerprint) { results.push({ project_key: project.project_id, status: "unchanged", fingerprint }); continue; }
    const change = proposeProjectChange(db, project.project_id, {
      change_type: "progress",
      summary: normalized ? "白名单项目工作区发生 Git 变化" : "白名单项目工作区已恢复干净",
      proposed_value: { git_dirty: Boolean(normalized), changed_paths: normalized.split("\n").filter(Boolean).slice(0, 50) },
      impact: ["需要判断这些文件变化是否代表真实项目进展", "确认前不修改正式项目状态"],
      source: { kind: "git_observer", reference: fingerprint },
      evidence: [{ kind: "git_status_porcelain", sha256: fingerprint, line_count: normalized ? normalized.split("\n").length : 0 }],
      confidence: "high"
    });
    results.push({ project_key: project.project_id, status: "candidate_created", change_id: change.change_id, fingerprint });
  }
  return results;
}

export function captureVerifiedRunProjectChange(db, runId) {
  const row = db.prepare("SELECT r.run_id,r.status,p.plan_json,g.contract_json,v.passed,v.verifier,v.report_json FROM runs r JOIN tasks t ON t.task_id=r.task_id JOIN plans p ON p.plan_id=t.plan_id JOIN goals g ON g.goal_id=p.goal_id JOIN verifications v ON v.run_id=r.run_id WHERE r.run_id=?").get(runId);
  if (!row) return null;
  const plan = JSON.parse(row.plan_json), projectKey = plan.project_key ?? plan.project_id;
  if (!projectKey || !db.prepare("SELECT 1 FROM creator_project_profiles WHERE project_key=? AND execution_policy!='no_access'").get(projectKey)) return null;
  const existing = db.prepare("SELECT change_id FROM project_change_candidates WHERE source_json LIKE ?").get('%"reference":"' + runId + '"%');
  if (existing) return existing.change_id;
  return proposeProjectChange(db, projectKey, {
    change_type: "progress",
    summary: row.passed ? "Agent执行结果已通过独立复核" : "Agent执行结果未通过独立复核",
    proposed_value: { run_id: runId, verification_passed: Boolean(row.passed), run_status: row.status },
    impact: ["这是执行证据，不会自动把项目标记为完成", "需要奈奈确认它对项目进度的含义"],
    source: { kind: "verified_agent_run", reference: runId },
    evidence: [{ kind: "verification", verifier: row.verifier }],
    confidence: "high"
  }).change_id;
}