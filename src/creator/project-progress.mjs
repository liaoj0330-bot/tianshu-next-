import { proposeProjectChange } from "./project-changes.mjs";

const STATUSES = new Set(["not_started", "in_progress", "blocked", "awaiting_review", "awaiting_acceptance", "completed", "paused"]);
const BASIS_KINDS = new Set(["milestones", "deliverables", "manual_estimate"]);
const MILESTONE_STATUSES = new Set(["pending", "in_progress", "completed", "blocked"]);

const parse = (value, fallback = null) => {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
};
const text = (value, field, { required = true } = {}) => {
  if (value == null || String(value).trim() === "") {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  return String(value).trim();
};

export function normalizeProjectProgress(input = {}) {
  const status = text(input.status, "status");
  if (!STATUSES.has(status)) throw new Error("invalid progress status");
  const stage = text(input.stage, "stage");
  const basisInput = input.basis ?? {};
  const kind = text(basisInput.kind, "basis.kind");
  if (!BASIS_KINDS.has(kind)) throw new Error("invalid progress basis.kind");
  const description = text(basisInput.description, "basis.description");
  let percent;
  let basis;
  if (kind === "manual_estimate") {
    percent = Number(basisInput.percent ?? input.percent_complete);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error("manual progress percent must be an integer from 0 to 100");
    basis = { kind, percent, description };
  } else {
    const completed = Number(basisInput.completed);
    const total = Number(basisInput.total);
    if (!Number.isInteger(completed) || !Number.isInteger(total) || total < 1 || completed < 0 || completed > total) throw new Error("milestone progress requires completed and total integers");
    percent = Math.round((completed / total) * 100);
    basis = { kind, completed, total, description };
  }
  const milestones = Array.isArray(input.milestones) ? input.milestones.map((item, index) => {
    const title = text(item?.title, `milestones[${index}].title`);
    const milestoneStatus = text(item?.status, `milestones[${index}].status`);
    if (!MILESTONE_STATUSES.has(milestoneStatus)) throw new Error(`invalid milestones[${index}].status`);
    return { id: text(item?.id ?? `m${index + 1}`, `milestones[${index}].id`), title, status: milestoneStatus, evidence: Array.isArray(item?.evidence) ? item.evidence : [] };
  }) : [];
  if (status === "completed" && percent !== 100) throw new Error("completed progress must be 100 percent");
  if (percent === 100 && status === "in_progress") throw new Error("100 percent progress must await review, acceptance, or completion");
  const blockers = Array.isArray(input.blockers) ? input.blockers.map((item) => text(item, "blockers[]")).filter(Boolean) : [];
  if (status === "blocked" && !blockers.length) throw new Error("blocked progress requires at least one blocker");
  return {
    schema_version: 1,
    percent_complete: percent,
    status,
    stage,
    basis,
    milestones,
    current_outcome: text(input.current_outcome, "current_outcome", { required: false }),
    next_action: text(input.next_action, "next_action", { required: status !== "completed" }),
    blockers,
    reported_at: input.reported_at ? new Date(input.reported_at).toISOString() : new Date().toISOString(),
  };
}

export function isFormalProjectProgress(value) {
  return Boolean(value && value.schema_version === 1 && Number.isInteger(value.percent_complete) && STATUSES.has(value.status) && value.basis);
}

export function getProjectProgressReadModel(db, projectKey) {
  const current = db.prepare("SELECT value_json,source_change_id,updated_at FROM project_current_state WHERE project_key=? AND state_key='progress'").get(projectKey);
  const currentValue = parse(current?.value_json);
  const pendingRow = db.prepare("SELECT change_id,summary,proposed_json,source_json,evidence_json,confidence,created_at FROM project_change_candidates WHERE project_key=? AND change_type='progress' AND status='awaiting_creator_confirmation' ORDER BY created_at DESC LIMIT 1").get(projectKey);
  const pendingValue = parse(pendingRow?.proposed_json);
  const formalPending = pendingRow && isFormalProjectProgress(pendingValue);
  return {
    is_formal: isFormalProjectProgress(currentValue),
    current: isFormalProjectProgress(currentValue) ? currentValue : null,
    legacy: currentValue && !isFormalProjectProgress(currentValue) ? currentValue : null,
    source_change_id: current?.source_change_id ?? null,
    updated_at: current?.updated_at ?? null,
    pending: formalPending ? {
      change_id: pendingRow.change_id,
      summary: pendingRow.summary,
      value: pendingValue,
      source: parse(pendingRow.source_json, {}),
      evidence: parse(pendingRow.evidence_json, []),
      confidence: pendingRow.confidence,
      created_at: pendingRow.created_at,
    } : null,
    legacy_pending: pendingRow && !formalPending ? { change_id: pendingRow.change_id, summary: pendingRow.summary, created_at: pendingRow.created_at } : null,
  };
}

export function proposeProjectProgress(db, projectKey, input = {}) {
  const progress = normalizeProjectProgress(input);
  return proposeProjectChange(db, projectKey, {
    change_type: "progress",
    summary: input.summary?.trim() || `更新${projectKey}项目完成度到 ${progress.percent_complete}%`,
    proposed_value: progress,
    impact: ["会更新项目完成度和当前阶段", "需要你确认后才成为正式状态", "不会创建任务或派发 Agent"],
    source: input.source,
    evidence: input.evidence ?? [],
    confidence: input.confidence ?? "medium",
  });
}

export function projectProgressPercent(progress) {
  return isFormalProjectProgress(progress?.current) ? progress.current.percent_complete : null;
}

export const PROJECT_PROGRESS_STATUSES = Object.freeze([...STATUSES]);
