import { appendEvent, canonicalJson, newId, now } from "../core/store.mjs";
import { indexProjectChange, updateIndexedProjectChangeDecision } from "../indexing/knowledge-index.mjs";

const TYPES = new Set(["stage", "progress", "risk", "deadline", "priority", "status", "note"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const atomic = (db, work) => { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } };
const parse = (value, fallback = null) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };

function deriveImpact(row) {
  const value = parse(row.proposed_json), reasons = [], flags = [];
  let score = row.status === "awaiting_creator_confirmation" ? 10 : 0;
  if (row.change_type === "risk") { score += 30; reasons.push("风险状态发生变化"); flags.push("risk_review"); }
  if (row.change_type === "deadline") { score += 25; reasons.push("时间窗口发生变化"); flags.push("schedule_review"); }
  if (row.change_type === "priority") { score += 20; reasons.push("需要重新核对战略优先级"); flags.push("priority_review"); }
  if (value?.verification_passed === false) { score += 35; reasons.push("独立复核未通过"); flags.push("verification_failed"); }
  if (row.confidence === "low") { score += 10; reasons.push("证据可信度偏低"); flags.push("needs_clarification"); }
  return { attention_delta: Math.min(60, score), reasons, flags, changes_strategic_priority: false };
}

function decorate(db, row) {
  if (!row) return null;
  const conflicts = db.prepare("SELECT change_id,summary,proposed_json,created_at FROM project_change_candidates WHERE project_key=? AND change_type=? AND status='awaiting_creator_confirmation' AND change_id<>? AND proposed_json<>? ORDER BY created_at").all(row.project_key, row.change_type, row.change_id, row.proposed_json).map((item) => ({ ...item, proposed_value: parse(item.proposed_json) }));
  return { ...row, previous_value: parse(row.previous_json), proposed_value: parse(row.proposed_json), impact: parse(row.impact_json, []), source: parse(row.source_json, {}), evidence: parse(row.evidence_json, []), conflicts, impact_assessment: deriveImpact(row) };
}

export function proposeProjectChange(db, projectKey, input = {}) {
  const project = db.prepare("SELECT project_key,execution_policy FROM creator_project_profiles WHERE project_key=?").get(projectKey);
  if (!project) throw new Error("creator project not found");
  if (project.execution_policy === "no_access") throw new Error("protected project cannot receive changes");
  if (!TYPES.has(input.change_type)) throw new Error("invalid project change type");
  if (!input.summary?.trim()) throw new Error("project change summary is required");
  if (input.proposed_value === undefined) throw new Error("proposed_value is required");
  if (!input.source?.kind || !input.source?.reference) throw new Error("project change source kind and reference are required");
  if (!CONFIDENCE.has(input.confidence ?? "medium")) throw new Error("invalid confidence");
  const proposedJson = canonicalJson(input.proposed_value);
  const duplicate = db.prepare("SELECT change_id FROM project_change_candidates WHERE project_key=? AND change_type=? AND proposed_json=? AND status='awaiting_creator_confirmation'").get(projectKey, input.change_type, proposedJson);
  if (duplicate) return { ...getProjectChange(db, duplicate.change_id), deduplicated: true };
  const current = db.prepare("SELECT value_json FROM project_current_state WHERE project_key=? AND state_key=?").get(projectKey, input.change_type);
  const id = newId("project_change"), stamp = now();
  db.prepare("INSERT INTO project_change_candidates VALUES (?,?,?,?,?,?,?,?,?,?,'awaiting_creator_confirmation',?,NULL,NULL,NULL)")
    .run(id, projectKey, input.change_type, current?.value_json ?? null, proposedJson, input.summary.trim(), canonicalJson(input.impact ?? []), canonicalJson(input.source), canonicalJson(input.evidence ?? []), input.confidence ?? "medium", stamp);
  appendEvent(db, "project_change", id, "project_change.proposed", { project_key: projectKey, change_type: input.change_type });
  try { indexProjectChange(db, id); } catch { /* index can be rebuilt from SQLite facts */ }
  return getProjectChange(db, id);
}

export function decideProjectChange(db, changeId, { decision, decided_by = "creator", reason = "" } = {}) {
  if (!["accept", "reject"].includes(decision)) throw new Error("decision must be accept or reject");
  return atomic(db, () => {
    const row = db.prepare("SELECT * FROM project_change_candidates WHERE change_id=? AND status='awaiting_creator_confirmation'").get(changeId);
    if (!row) throw new Error("project change is not awaiting creator confirmation");
    const status = decision === "accept" ? "accepted" : "rejected", stamp = now();
    db.prepare("UPDATE project_change_candidates SET status=?,decided_at=?,decided_by=?,decision_reason=? WHERE change_id=?").run(status, stamp, decided_by, reason, changeId);
    if (status === "accepted") {
      db.prepare("INSERT INTO project_current_state(project_key,state_key,value_json,source_change_id,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(project_key,state_key) DO UPDATE SET value_json=excluded.value_json,source_change_id=excluded.source_change_id,updated_at=excluded.updated_at").run(row.project_key, row.change_type, row.proposed_json, changeId, stamp);
      const superseded = db.prepare("SELECT change_id FROM project_change_candidates WHERE project_key=? AND change_type=? AND status='awaiting_creator_confirmation'").all(row.project_key, row.change_type);
      db.prepare("UPDATE project_change_candidates SET status='superseded',decided_at=?,decided_by=?,decision_reason=? WHERE project_key=? AND change_type=? AND status='awaiting_creator_confirmation'").run(stamp, decided_by, "conflicting change superseded by " + changeId, row.project_key, row.change_type);
      for (const item of superseded) appendEvent(db, "project_change", item.change_id, "project_change.superseded", { accepted_change_id: changeId, decided_by });
    }
    appendEvent(db, "project_change", changeId, "project_change." + status, { project_key: row.project_key, decided_by });
    updateIndexedProjectChangeDecision(db, changeId);
    if (status === "accepted") for (const item of db.prepare("SELECT change_id FROM project_change_candidates WHERE project_key=? AND change_type=? AND status='superseded'").all(row.project_key,row.change_type)) updateIndexedProjectChangeDecision(db,item.change_id);
    return getProjectChange(db, changeId);
  });
}

export function getProjectChange(db, changeId) {
  return decorate(db, db.prepare("SELECT * FROM project_change_candidates WHERE change_id=?").get(changeId));
}

export function listProjectChanges(db, { project_key = null, status = null, after_id = 0 } = {}) {
  const clauses = ["rowid > ?"], args = [Number(after_id) || 0];
  if (project_key) { clauses.push("project_key=?"); args.push(project_key); }
  if (status) { clauses.push("status=?"); args.push(status); }
  return db.prepare("SELECT rowid cursor,* FROM project_change_candidates WHERE " + clauses.join(" AND ") + " ORDER BY rowid ASC").all(...args).map((row) => decorate(db, row));
}

export function getProjectCurrentState(db, projectKey) {
  return Object.fromEntries(db.prepare("SELECT state_key,value_json,source_change_id,updated_at FROM project_current_state WHERE project_key=? ORDER BY state_key").all(projectKey).map((row) => [row.state_key, { value: parse(row.value_json), source_change_id: row.source_change_id, updated_at: row.updated_at }]));
}

export function getProjectAttention(db, projectKey) {
  const rows = db.prepare("SELECT * FROM project_change_candidates WHERE project_key=? AND status='awaiting_creator_confirmation'").all(projectKey);
  const groups = new Map(), reasons = [], flags = new Set();
  let score = 0;
  for (const row of rows) {
    const impact = deriveImpact(row); score += impact.attention_delta; reasons.push(...impact.reasons); for (const flag of impact.flags) flags.add(flag);
    const values = groups.get(row.change_type) ?? new Set(); values.add(row.proposed_json); groups.set(row.change_type, values);
  }
  const conflicts = [...groups.values()].filter((values) => values.size > 1).length;
  if (conflicts) { score += conflicts * 30; reasons.push("存在相互冲突的待确认变化"); flags.add("conflict"); }
  return { score: Math.min(100, score), level: score >= 70 ? "critical" : score >= 40 ? "watch" : score > 0 ? "pending" : "stable", pending_changes: rows.length, conflicts, reasons: [...new Set(reasons)], flags: [...flags], strategic_priority_unchanged: true };
}