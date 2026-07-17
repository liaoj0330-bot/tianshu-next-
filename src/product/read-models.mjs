import { getAuthorityReadModel } from "../governance/authority.mjs";
import { getCreatorPortfolio } from "../creator/project-priority.mjs";
import { getExperience, getJudgment } from "../intelligence/judgment-loop.mjs";
import { buildTodayReadModel } from "./today-read-model.mjs";

export const WORKSPACE_LABELS = Object.freeze({
  today: "Today",
  projects: "Projects",
  life: "Life",
  relationships: "Relationships",
  knowledge: "Knowledge",
  evolution: "Evolution",
  activity: "Activity",
  inbox: "Inbox",
});
export const VISIBLE_WORKSPACES = Object.freeze(
  Object.keys(WORKSPACE_LABELS).filter((workspace) => workspace !== "inbox"),
);
const WORKSPACE_SET = new Set(VISIBLE_WORKSPACES);

function parse(value, fallback = null) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}

function limit(value, fallback = 50) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(parsed, 200)) : fallback;
}

function containsProtectedReference(value, references) {
  if (value == null) return false;
  if (typeof value === "string") return references.has(value);
  if (Array.isArray(value)) return value.some((item) => containsProtectedReference(item, references));
  if (typeof value === "object") {
    return Object.values(value).some((item) => containsProtectedReference(item, references));
  }
  return false;
}

function envelope(kind, data) {
  return {
    model: kind,
    state_authority: "sqlite",
    source_of_truth: "sqlite",
    generated_at: new Date().toISOString(),
    ...data,
  };
}

function assertWorkspace(workspace) {
  if (!WORKSPACE_SET.has(workspace)) throw new Error(`unknown workspace: ${workspace}`);
  return workspace;
}

function assignmentDecisionState(status) {
  if (["confirmed", "corrected"].includes(status)) return "creator_confirmed";
  if (["needs_creator_confirmation", "unresolved"].includes(status)) return "awaiting_creator_confirmation";
  return "system_classified";
}

function decorateAssignment(row) {
  return {
    proposed_workspace: row.proposed_workspace,
    effective_workspace: row.effective_workspace,
    status: row.workspace_status ?? row.status,
    decision_state: assignmentDecisionState(row.workspace_status ?? row.status),
    confidence: row.confidence,
    candidates: parse(row.candidates_json, []),
    reason_codes: parse(row.reason_codes_json, []),
    classified_by: row.classified_by,
    decided_by: row.decided_by ?? null,
    decision_reason: row.decision_reason ?? null,
  };
}

function readState(db, subjectId = "creator") {
  const subject = db.prepare("SELECT * FROM state_subjects WHERE subject_id=?").get(subjectId);
  if (!subject) return null;
  const snapshot = subject.current_snapshot_id
    ? db.prepare("SELECT * FROM state_snapshots WHERE snapshot_id=?").get(subject.current_snapshot_id)
    : null;
  return {
    subject_id: subject.subject_id,
    display_name: subject.display_name,
    updated_at: subject.updated_at,
    current_snapshot: snapshot ? {
      snapshot_id: snapshot.snapshot_id,
      version: snapshot.version,
      state: parse(snapshot.state_json, {}),
      source: parse(snapshot.source_json, {}),
      created_at: snapshot.created_at,
    } : null,
  };
}

function readPendingState(db) {
  return db.prepare(`
    SELECT cycle_id,subject_id,observed_at,input_json,comparison_json,proposed_state_json,
           questions_json,next_action_json,status,created_at,updated_at
    FROM state_update_cycles
    WHERE status='awaiting_creator_decision'
    ORDER BY created_at DESC
  `).all().map((row) => ({
    cycle_id: row.cycle_id,
    subject_id: row.subject_id,
    observed_at: row.observed_at,
    comparison: parse(row.comparison_json, {}),
    proposed_state: parse(row.proposed_state_json, {}),
    questions: parse(row.questions_json, []),
    next_action: parse(row.next_action_json, {}),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function readIntakes(db, workspace, rowLimit) {
  return db.prepare(`
    SELECT i.intake_id,i.source,i.payload_json,i.status,i.created_at,
           w.proposed_workspace,w.effective_workspace,w.status workspace_status,
           w.confidence,w.candidates_json,w.reason_codes_json,w.classified_by,
           w.decided_by,w.decision_reason
    FROM intake_events i
    JOIN workspace_assignments w ON w.intake_id=i.intake_id
    WHERE w.effective_workspace=?
    ORDER BY i.created_at DESC LIMIT ?
  `).all(workspace, rowLimit).map((row) => {
    const payload = parse(row.payload_json, {});
    return {
      intake_id: row.intake_id,
      source: row.source,
      message: payload.message ?? null,
      interaction: payload.interaction ?? null,
      status: row.status,
      created_at: row.created_at,
      assignment: decorateAssignment(row),
    };
  });
}

function readPendingWorkspaceConfirmations(db, rowLimit = 50) {
  return db.prepare(`
    SELECT w.assignment_id,w.intake_id,w.proposed_workspace,w.effective_workspace,
           w.status workspace_status,w.confidence,w.candidates_json,w.reason_codes_json,
           w.classified_by,w.decided_by,w.decision_reason,w.created_at,w.updated_at,
           i.source,i.payload_json
    FROM workspace_assignments w
    JOIN intake_events i ON i.intake_id=w.intake_id
    WHERE w.status IN ('needs_creator_confirmation','unresolved')
    ORDER BY w.updated_at DESC LIMIT ?
  `).all(rowLimit).map((row) => {
    const payload = parse(row.payload_json, {});
    return {
      assignment_id: row.assignment_id,
      intake_id: row.intake_id,
      source: row.source,
      message: payload.message ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      assignment: decorateAssignment(row),
    };
  });
}

function projectReadModel(db, rowLimit) {
  const portfolio = getCreatorPortfolio(db);
  const protectedProjectCount = portfolio.filter(
    (project) => project.execution_policy === "no_access",
  ).length;
  const projects = portfolio
    .filter((project) => project.execution_policy !== "no_access")
    .map((project) => ({
    ...project,
    evidence_state: project.assessment?.status === "confirmed" ? "confirmed" : "candidate_or_baseline",
    current_state: Object.fromEntries(db.prepare(
      "SELECT state_key,value_json,source_change_id,updated_at FROM project_current_state WHERE project_key=? ORDER BY state_key"
    ).all(project.project_key).map((row) => [row.state_key, {
      value: parse(row.value_json), source_change_id: row.source_change_id, updated_at: row.updated_at,
    }])),
    pending_changes: db.prepare(`
      SELECT change_id,change_type,previous_json,proposed_json,summary,impact_json,evidence_json,confidence,status,created_at
      FROM project_change_candidates WHERE project_key=? AND status='awaiting_creator_confirmation'
      ORDER BY created_at DESC LIMIT ?
    `).all(project.project_key, rowLimit).map((change) => ({
      ...change,
      previous_value: parse(change.previous_json),
      proposed_value: parse(change.proposed_json, {}),
      impact: parse(change.impact_json, []),
      evidence: parse(change.evidence_json, []),
    })),
    }));
  return { projects, protected_project_count: protectedProjectCount };
}

function knowledgeReadModel(db, rowLimit) {
  const entities = db.prepare(`
    SELECT entity_id,entity_type,canonical_key,display_name,access_policy,status,valid_from,valid_to,metadata_json,updated_at
    FROM knowledge_entities
    WHERE access_policy!='protected'
    ORDER BY updated_at DESC LIMIT ?
  `).all(rowLimit).map((entity) => ({
    ...entity,
    metadata: parse(entity.metadata_json, {}),
    evidence: db.prepare(`
      SELECT evidence_id,claim_type,value_json,confidence,status,valid_from,valid_to,updated_at
      FROM knowledge_evidence WHERE entity_id=? ORDER BY updated_at DESC LIMIT ?
    `).all(entity.entity_id, rowLimit).map((item) => ({ ...item, value: parse(item.value_json) })),
  }));
  return {
    entities,
    health: db.prepare(
      "SELECT COUNT(*) count FROM knowledge_entities WHERE status='active' AND access_policy!='protected'",
    ).get(),
  };
}

function evolutionReadModel(db, rowLimit) {
  const experiences = db.prepare(`
    SELECT experience_id FROM experiences ORDER BY updated_at DESC LIMIT ?
  `).all(rowLimit).map((item) => {
    const experience = getExperience(db, item.experience_id);
    const currentVersion = experience.versions.find(
      (version) => version.version_id === experience.current_version_id,
    ) ?? null;
    return {
      ...experience,
      current_version: currentVersion,
      pending_version: [...experience.versions].reverse().find((version) => version.status === "candidate") ?? null,
      usage_summary: {
        total: experience.usages.length,
        evaluated: experience.usages.filter((usage) => usage.evaluation).length,
        helpful: experience.usages.filter((usage) => usage.evaluation?.assessment === "helpful").length,
        harmful: experience.usages.filter((usage) => usage.evaluation?.assessment === "harmful").length,
      },
    };
  });
  const memory_candidates = db.prepare(`
    SELECT candidate_id,subject_id,statement,scope,occurrence_count,counterexamples_json,source_ids_json,status,created_at,updated_at
    FROM memory_candidates ORDER BY updated_at DESC LIMIT ?
  `).all(rowLimit).map((item) => ({ ...item, counterexamples: parse(item.counterexamples_json, []), source_ids: parse(item.source_ids_json, []) }));
  const evolution_candidates = db.prepare(`
    SELECT candidate_id,kind,title,payload_json,status,source_json,created_at,updated_at
    FROM evolution_candidates ORDER BY updated_at DESC LIMIT ?
  `).all(rowLimit).map((item) => ({ ...item, payload: parse(item.payload_json, {}), source: parse(item.source_json, {}) }));
  return { experiences, memory_candidates, evolution_candidates };
}

function activityReadModel(db, rowLimit) {
  const protectedReferences = new Set(db.prepare(`
    SELECT project_key,display_name FROM creator_project_profiles
    WHERE execution_policy='no_access'
  `).all().flatMap((project) => [project.project_key, project.display_name]));
  const goals = db.prepare("SELECT goal_id,contract_json,status,created_at,updated_at FROM goals ORDER BY updated_at DESC LIMIT ?").all(rowLimit).map((goal) => ({
    ...goal,
    contract: parse(goal.contract_json, {}),
    plans: db.prepare(`
      SELECT p.plan_id,p.plan_json,p.risk_level,p.status plan_status,p.created_at,p.updated_at,
             t.task_id,t.status task_status,r.run_id,r.status run_status,r.updated_at run_updated_at,
             v.passed,v.verifier,v.report_json
      FROM plans p LEFT JOIN tasks t ON t.plan_id=p.plan_id LEFT JOIN runs r ON r.task_id=t.task_id
      LEFT JOIN verifications v ON v.run_id=r.run_id WHERE p.goal_id=? ORDER BY p.updated_at DESC LIMIT ?
    `).all(goal.goal_id, rowLimit).map((plan) => ({
      ...plan,
      plan: parse(plan.plan_json, {}),
      report: parse(plan.report_json, null),
    })),
  })).filter((goal) => !containsProtectedReference(goal, protectedReferences));
  const events = db.prepare("SELECT event_id,entity_type,entity_id,event_type,payload_json,created_at FROM events ORDER BY event_id DESC LIMIT ?").all(rowLimit).map((event) => ({ ...event, payload: parse(event.payload_json, {}) }))
    .filter((event) => !containsProtectedReference(event, protectedReferences));
  const jobs = db.prepare(`
    SELECT job_id,project_id,payload_json,status,attempts,max_attempts,available_at,
           lease_id,created_at,updated_at
    FROM jobs ORDER BY updated_at DESC LIMIT ?
  `).all(rowLimit).map((job) => ({
    ...job,
    payload: parse(job.payload_json, {}),
    can_cancel: ["queued", "leased", "running", "retry_wait", "recovery_required"].includes(job.status),
    can_retry: ["failed", "recovery_required"].includes(job.status) && job.attempts < 3,
    failures: db.prepare(`
      SELECT failure_id,code failure_code,detail_json,created_at
      FROM failure_cases WHERE job_id=? ORDER BY created_at DESC
    `).all(job.job_id).map((failure) => ({ ...failure, detail: parse(failure.detail_json, {}) })),
  })).filter((job) => !containsProtectedReference(job, protectedReferences));
  return { goals, jobs, events };
}

export function buildCreatorModelReadModel(db) {
  const authority = getAuthorityReadModel(db);
  return envelope("creator_model", {
    authority,
    state: readState(db),
    pending_state_updates: readPendingState(db),
    pending_workspace_confirmations: readPendingWorkspaceConfirmations(db),
    pending_questions: db.prepare("SELECT question_id,subject_id,question_key,question_text,why_it_matters,status,asked_at FROM state_questions WHERE status='pending' ORDER BY asked_at").all(),
    memory_candidates: db.prepare("SELECT candidate_id,subject_id,statement,scope,occurrence_count,status,counterexamples_json,source_ids_json,created_at,updated_at FROM memory_candidates ORDER BY updated_at DESC LIMIT 50").all().map((row) => ({ ...row, counterexamples: parse(row.counterexamples_json, []), source_ids: parse(row.source_ids_json, []) })),
  });
}

export function listJudgmentReadModel(db, { workspace, status, limit: rowLimit } = {}) {
  if (workspace != null) assertWorkspace(workspace);
  const allowedStatuses = new Set(["awaiting_creator_feedback", "accepted", "corrected", "rejected", "deferred", "ignored"]);
  if (status != null && !allowedStatuses.has(status)) throw new Error(`unknown judgment status: ${status}`);
  const clauses = [`NOT EXISTS (
    SELECT 1 FROM creator_project_profiles p
    WHERE p.execution_policy='no_access' AND p.project_key=judgments.subject_id
  )`], params = [];
  if (workspace != null) { clauses.push("workspace=?"); params.push(workspace); }
  if (status === "ignored") {
    clauses.push(`EXISTS (
      SELECT 1 FROM judgment_feedback f
      JOIN judgment_feedback_extensions x ON x.feedback_id=f.feedback_id
      WHERE f.judgment_id=judgments.judgment_id AND x.semantic_decision='ignore'
    )`);
  } else if (status === "deferred") {
    clauses.push(`status='deferred' AND NOT EXISTS (
      SELECT 1 FROM judgment_feedback f
      JOIN judgment_feedback_extensions x ON x.feedback_id=f.feedback_id
      WHERE f.judgment_id=judgments.judgment_id AND x.semantic_decision='ignore'
    )`);
  } else if (status != null) {
    clauses.push("status=?"); params.push(status);
  }
  params.push(limit(rowLimit));
  const rows = db.prepare(`SELECT judgment_id,intake_id,subject_type,subject_id,workspace,question,recommendation_json,confidence,status,created_by,created_at,updated_at FROM judgments ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...params);
  return envelope("judgments", {
    filters: { workspace: workspace ?? null, status: status ?? null },
    items: rows.map((row) => {
      const detail = getJudgment(db, row.judgment_id);
      return {
        ...row,
        status: detail?.status ?? row.status,
        facts: detail?.effective?.facts ?? detail?.facts ?? [],
        inferences: detail?.effective?.inferences ?? detail?.inferences ?? [],
        evidence: detail?.effective?.evidence ?? detail?.evidence ?? [],
        uncertainties: detail?.effective?.uncertainties ?? detail?.uncertainties ?? [],
        alternatives: detail?.effective?.alternatives ?? detail?.alternatives ?? [],
        recommendation: detail?.effective?.recommendation ?? parse(row.recommendation_json, {}),
        experience_citations: detail?.experience_citations ?? [],
        feedback: detail?.feedback ?? null,
      };
    }),
  });
}

export function buildWorkspaceReadModel(db, workspace, { limit: rowLimit } = {}) {
  assertWorkspace(workspace);
  const n = limit(rowLimit);
  const today = workspace === "today" ? buildTodayReadModel(db) : null;
  const projectData = ["projects", "today"].includes(workspace) ? projectReadModel(db, n) : null;
  const data = workspace === "today"
    ? { ...today, label: WORKSPACE_LABELS[workspace] }
    : workspace === "projects"
      ? {
          label: WORKSPACE_LABELS[workspace],
          ...projectData,
          recent_intakes: readIntakes(db, workspace, n),
          judgments: listJudgmentReadModel(db, { workspace, limit: n }).items,
        }
      : workspace === "knowledge"
        ? { label: WORKSPACE_LABELS[workspace], ...knowledgeReadModel(db, n), judgments: listJudgmentReadModel(db, { workspace, limit: n }).items }
        : workspace === "evolution"
          ? { label: WORKSPACE_LABELS[workspace], ...evolutionReadModel(db, n), judgments: listJudgmentReadModel(db, { workspace, limit: n }).items }
          : workspace === "activity"
            ? { label: WORKSPACE_LABELS[workspace], ...activityReadModel(db, n), recent_intakes: readIntakes(db, workspace, n) }
            : { label: WORKSPACE_LABELS[workspace], recent_intakes: readIntakes(db, workspace, n), judgments: listJudgmentReadModel(db, { workspace, limit: n }).items };
  return envelope("workspace", { workspace, ...data });
}

export function buildWorkspaceIndexReadModel(db) {
  const items = VISIBLE_WORKSPACES.map((workspace) => {
    const assignments = db.prepare("SELECT COUNT(*) count FROM workspace_assignments WHERE effective_workspace=?").get(workspace).count;
    const judgments = db.prepare("SELECT COUNT(*) count FROM judgments WHERE workspace=?").get(workspace).count;
    return { workspace, label: WORKSPACE_LABELS[workspace], assignment_count: assignments, judgment_count: judgments };
  });
  const pending_confirmation_count = db.prepare(`
    SELECT COUNT(*) count FROM workspace_assignments
    WHERE status IN ('needs_creator_confirmation','unresolved')
  `).get().count;
  return envelope("workspace_index", { items, pending_confirmation_count });
}
