import { appendEvent, canonicalJson, newId, now } from "../core/store.mjs";
import { assertAuthority } from "../governance/authority.mjs";
import { WORKSPACES } from "./workspace-classifier.mjs";

const WORKSPACE_SET = new Set(WORKSPACES);
const parse = (value, fallback = []) => { try { return JSON.parse(value); } catch { return fallback; } };

function decorate(row) {
  if (!row) return null;
  return {
    ...row,
    candidates: parse(row.candidates_json),
    reason_codes: parse(row.reason_codes_json),
  };
}

export function recordWorkspaceAssignment(db, intakeId, classification) {
  if (!classification || !WORKSPACE_SET.has(classification.workspace)) throw new Error("invalid workspace classification");
  const assignmentId = newId("workspace"), stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO workspace_assignments(
        assignment_id,intake_id,proposed_workspace,effective_workspace,status,
        confidence,candidates_json,reason_codes_json,classified_by,source,
        decided_by,decision_reason,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)
    `).run(
      assignmentId,
      intakeId,
      classification.workspace,
      classification.workspace,
      classification.status,
      classification.confidence,
      canonicalJson(classification.candidates ?? []),
      canonicalJson(classification.reason_codes ?? []),
      "tianshu_workspace_classifier_v1",
      classification.source ?? "unknown",
      stamp,
      stamp,
    );
    db.prepare(`
      INSERT INTO workspace_assignment_revisions(
        revision_id,assignment_id,version,workspace,decision,decided_by,reason,created_at
      ) VALUES (?,?,1,?,'classified','tianshu_workspace_classifier_v1',?,?)
    `).run(newId("workspace_revision"), assignmentId, classification.workspace, (classification.reason_codes ?? []).join(","), stamp);
    appendEvent(db, "workspace_assignment", assignmentId, "workspace_assignment.classified", {
      intake_id: intakeId,
      workspace: classification.workspace,
      status: classification.status,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getWorkspaceAssignment(db, assignmentId);
}

export function getWorkspaceAssignment(db, assignmentId) {
  const row = db.prepare("SELECT * FROM workspace_assignments WHERE assignment_id=?").get(assignmentId);
  if (!row) return null;
  return {
    ...decorate(row),
    revisions: db.prepare("SELECT * FROM workspace_assignment_revisions WHERE assignment_id=? ORDER BY version")
      .all(assignmentId),
  };
}

export function getWorkspaceAssignmentForIntake(db, intakeId) {
  const row = db.prepare("SELECT assignment_id FROM workspace_assignments WHERE intake_id=?").get(intakeId);
  return row ? getWorkspaceAssignment(db, row.assignment_id) : null;
}

export function decideWorkspaceAssignment(db, intakeId, {
  decision,
  workspace = null,
  decided_by = "creator",
  reason = "",
} = {}) {
  if (!["confirm", "correct"].includes(decision)) throw new Error("workspace decision must be confirm or correct");
  const actor = assertAuthority(db, decided_by, "formal_state.confirm");
  const current = getWorkspaceAssignmentForIntake(db, intakeId);
  if (!current) throw new Error("workspace assignment not found");
  const effective = decision === "correct" ? workspace : current.effective_workspace;
  if (!WORKSPACE_SET.has(effective)) throw new Error("workspace correction requires a valid workspace");
  const status = decision === "correct" ? "corrected" : "confirmed", stamp = now();
  const version = current.revisions.length + 1;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE workspace_assignments
      SET effective_workspace=?,status=?,decided_by=?,decision_reason=?,updated_at=?
      WHERE assignment_id=?
    `).run(effective, status, actor, reason, stamp, current.assignment_id);
    db.prepare(`
      INSERT INTO workspace_assignment_revisions(
        revision_id,assignment_id,version,workspace,decision,decided_by,reason,created_at
      ) VALUES (?,?,?,?,?,?,?,?)
    `).run(newId("workspace_revision"), current.assignment_id, version, effective, decision, actor, reason, stamp);
    appendEvent(db, "workspace_assignment", current.assignment_id, `workspace_assignment.${status}`, {
      intake_id: intakeId,
      previous_workspace: current.effective_workspace,
      effective_workspace: effective,
      decided_by: actor,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getWorkspaceAssignment(db, current.assignment_id);
}

export function listPendingWorkspaceAssignments(db) {
  return db.prepare(`
    SELECT w.*,i.payload_json FROM workspace_assignments w
    JOIN intake_events i ON i.intake_id=w.intake_id
    WHERE w.status IN ('needs_creator_confirmation','unresolved')
    ORDER BY w.created_at DESC
  `).all().map((row) => {
    const payload = parse(row.payload_json, {});
    const { payload_json, ...assignment } = row;
    return { ...decorate(assignment), message: payload.message ?? null };
  });
}
