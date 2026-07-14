import { appendEvent, canonicalJson, newId, now } from "../core/store.mjs";

export const FACTOR_WEIGHTS = Object.freeze({ mission_alignment: 30, system_asset_leverage: 20, time_window: 15, evidence_quality: 15, dependency_urgency: 10, resource_pressure: -10 });
const FACTOR_KEYS = Object.keys(FACTOR_WEIGHTS);
const priorityBand = (score) => score >= 75 ? "focus_now" : score >= 55 ? "important" : score >= 35 ? "maintain" : "defer";
const confidence = (factors) => factors.evidence_quality >= 4 ? "high" : factors.evidence_quality >= 2 ? "medium" : "low";

function atomic(db, work) { db.exec("BEGIN IMMEDIATE"); try { const value = work(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } }

export function scoreCreatorProject(factors) {
  for (const key of FACTOR_KEYS) if (!Number.isFinite(factors?.[key]) || factors[key] < 0 || factors[key] > 5) throw new Error(`${key} must be a number from 0 to 5`);
  const weighted = Object.fromEntries(FACTOR_KEYS.map((key) => [key, (factors[key] / 5) * FACTOR_WEIGHTS[key]]));
  const score = Math.round(Math.max(0, Math.min(100, Object.values(weighted).reduce((sum, value) => sum + value, 0))) * 10) / 10;
  return { score, priority_band: priorityBand(score), confidence: confidence(factors), weighted };
}

export function upsertCreatorProjectBaseline(db, { projects, source }) {
  if (!Array.isArray(projects) || !projects.length) throw new Error("projects are required");
  if (!source?.kind || !source?.reference || !source?.version) throw new Error("source kind, reference and version are required");
  const stamp = now(), statement = db.prepare(`INSERT INTO creator_project_profiles(project_key, display_name, lane, baseline_priority, execution_policy, status, evidence_json, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_key) DO UPDATE SET display_name=excluded.display_name, lane=excluded.lane, baseline_priority=excluded.baseline_priority, execution_policy=excluded.execution_policy, status=excluded.status, evidence_json=excluded.evidence_json, source_json=excluded.source_json, updated_at=excluded.updated_at`);
  return atomic(db, () => projects.map((p) => { if (!p?.project_key || !p?.display_name || !p?.lane) throw new Error("project_key, display_name and lane are required"); if (!Number.isInteger(p.baseline_priority) || p.baseline_priority < 1 || p.baseline_priority > 5) throw new Error("baseline_priority must be 1..5"); if (!["eligible_after_approval", "read_only", "no_access"].includes(p.execution_policy)) throw new Error("invalid execution_policy"); if (!["active", "waiting", "auxiliary", "protected"].includes(p.status)) throw new Error("invalid project status"); statement.run(p.project_key, p.display_name, p.lane, p.baseline_priority, p.execution_policy, p.status, canonicalJson(p.evidence ?? []), canonicalJson(source), stamp, stamp); appendEvent(db, "creator_project", p.project_key, "creator_project.baseline_upserted", { source }); return p.project_key; }));
}

export function assessCreatorProject(db, projectKey, { factors, source, confirm = false } = {}) {
  if (!db.prepare("SELECT 1 FROM creator_project_profiles WHERE project_key=?").get(projectKey)) throw new Error("creator project not found");
  if (!source?.kind || !source?.reference) throw new Error("assessment source kind and reference are required");
  const result = scoreCreatorProject(factors), id = newId("priority"), stamp = now(), status = confirm ? "confirmed" : "candidate";
  atomic(db, () => {
    db.prepare("UPDATE creator_priority_assessments SET status='superseded' WHERE project_key=? AND status IN ('candidate','confirmed')").run(projectKey);
    db.prepare("INSERT INTO creator_priority_assessments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, projectKey, canonicalJson(factors), result.score, result.priority_band, result.confidence, status, canonicalJson(source), stamp, confirm ? stamp : null);
    appendEvent(db, "creator_project", projectKey, "creator_project.priority_assessed", { assessment_id: id, status, ...result });
  });
  return { assessment_id: id, project_key: projectKey, status, factors, ...result };
}

export function getCreatorPortfolio(db) {
  return db.prepare(`SELECT p.project_key, p.display_name, p.lane, p.baseline_priority, p.execution_policy, p.status, p.evidence_json, p.source_json, p.updated_at, a.assessment_id, a.factors_json, a.score, a.priority_band, a.confidence, a.status AS assessment_status, a.source_json AS assessment_source_json, a.created_at AS assessed_at, a.confirmed_at FROM creator_project_profiles p LEFT JOIN creator_priority_assessments a ON a.project_key=p.project_key AND a.status IN ('candidate','confirmed') ORDER BY COALESCE(a.score, p.baseline_priority * 20) DESC, p.project_key`).all().map((r) => ({ project_key: r.project_key, display_name: r.display_name, lane: r.lane, baseline_priority: r.baseline_priority, execution_policy: r.execution_policy, status: r.status, evidence: JSON.parse(r.evidence_json), source: JSON.parse(r.source_json), updated_at: r.updated_at, assessment: r.assessment_id ? { assessment_id: r.assessment_id, factors: JSON.parse(r.factors_json), score: r.score, priority_band: r.priority_band, confidence: r.confidence, status: r.assessment_status, source: JSON.parse(r.assessment_source_json), assessed_at: r.assessed_at, confirmed_at: r.confirmed_at } : null }));
}
