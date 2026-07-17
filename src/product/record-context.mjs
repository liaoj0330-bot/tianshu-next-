import { newId, now } from "../core/store.mjs";

export const RECORD_CONTEXT_KINDS = Object.freeze(["product", "development", "acceptance", "system"]);
export const RECORD_VISIBILITIES = Object.freeze(["primary", "secondary", "hidden"]);

function allowed(value, values, field) {
  if (!values.includes(value)) throw new Error(`invalid ${field}`);
  return value;
}

export function inferIntakeContext(input = {}) {
  const explicit = input.metadata?.context_kind;
  if (explicit != null) return allowed(explicit, RECORD_CONTEXT_KINDS, "context_kind");
  return input.source === "agenthub-dev" ? "development" : "product";
}

export function getRecordContext(db, entityType, entityId) {
  return db.prepare(`
    SELECT entity_type,entity_id,context_kind,visibility,source,reason,classified_by,
           version,created_at,updated_at
    FROM record_contexts WHERE entity_type=? AND entity_id=?
  `).get(entityType, entityId) ?? null;
}

export function setRecordContext(db, {
  entity_type,
  entity_id,
  context_kind,
  visibility = context_kind === "product" ? "primary" : "secondary",
  source = "explicit",
  reason = "",
  classified_by = "tianshu_orchestrator",
}) {
  const entityType = String(entity_type ?? "").trim();
  const entityId = String(entity_id ?? "").trim();
  if (!entityType || !entityId) throw new Error("entity_type and entity_id are required");
  allowed(context_kind, RECORD_CONTEXT_KINDS, "context_kind");
  allowed(visibility, RECORD_VISIBILITIES, "visibility");
  const current = getRecordContext(db, entityType, entityId);
  if (current?.context_kind === context_kind && current.visibility === visibility &&
      current.source === source && current.reason === reason) return current;
  const timestamp = now();
  const version = (current?.version ?? 0) + 1;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO record_context_revisions(
        revision_id,entity_type,entity_id,version,context_kind,visibility,
        source,reason,classified_by,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(newId("record_context_revision"), entityType, entityId, version, context_kind,
      visibility, source, reason, classified_by, timestamp);
    db.prepare(`
      INSERT INTO record_contexts(
        entity_type,entity_id,context_kind,visibility,source,reason,classified_by,
        version,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(entity_type,entity_id) DO UPDATE SET
        context_kind=excluded.context_kind,visibility=excluded.visibility,
        source=excluded.source,reason=excluded.reason,classified_by=excluded.classified_by,
        version=excluded.version,updated_at=excluded.updated_at
    `).run(entityType, entityId, context_kind, visibility, source, reason, classified_by,
      version, current?.created_at ?? timestamp, timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getRecordContext(db, entityType, entityId);
}

function contextFromIntake(db, intakeId) {
  return intakeId ? getRecordContext(db, "intake", intakeId) : null;
}

export function resolveConfirmationIntakeId(db, confirmation) {
  const direct = confirmation.result?.intake_id ?? confirmation.result?.interaction?.plan_candidate?.intake_id;
  if (direct) return direct;
  if (confirmation.type === "judgment") {
    return db.prepare("SELECT intake_id FROM judgments WHERE judgment_id=?").get(confirmation.confirmation_id)?.intake_id ?? null;
  }
  if (confirmation.type === "outcome") {
    return db.prepare(`
      SELECT j.intake_id FROM outcomes o JOIN judgments j ON j.judgment_id=o.judgment_id
      WHERE o.outcome_id=?
    `).get(confirmation.confirmation_id)?.intake_id ?? null;
  }
  const planId = confirmation.result?.interaction?.execution_candidate?.plan_id ??
    confirmation.result?.interaction?.task_candidate?.plan_id ??
    confirmation.result?.interaction?.run_candidate?.plan_id;
  if (!planId) return null;
  const source = db.prepare(`
    SELECT json_extract(g.contract_json,'$.source') source
    FROM plans p JOIN goals g ON g.goal_id=p.goal_id WHERE p.plan_id=?
  `).get(planId)?.source;
  return typeof source === "string" && source.startsWith("intake:") ? source.slice(7) : null;
}

export function resolveConfirmationContext(db, confirmation) {
  const direct = getRecordContext(db, "confirmation", confirmation.confirmation_id);
  const inherited = direct ?? contextFromIntake(db, resolveConfirmationIntakeId(db, confirmation));
  return inherited ?? {
    context_kind: "product",
    visibility: "primary",
    source: "default_product_context",
    reason: "",
  };
}
