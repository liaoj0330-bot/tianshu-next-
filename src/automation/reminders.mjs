import { appendEvent, canonicalJson, newId, now } from "../core/store.mjs";
import { assertAuthority } from "../governance/authority.mjs";

const parse = (value, fallback = null) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const atomic = (db, work) => { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } };

function decorate(row) {
  return row ? { ...row, schedule: parse(row.schedule_json, {}) } : null;
}

function validInstant(value, label) {
  const stamp = new Date(value);
  if (!value || !Number.isFinite(stamp.getTime())) throw new Error(label + " must be a valid ISO timestamp");
  return stamp.toISOString();
}

function nextDailyRun(scheduledFor, at) {
  let next = new Date(scheduledFor).getTime() + 86400000;
  const boundary = new Date(at).getTime();
  while (next <= boundary) next += 86400000;
  return new Date(next).toISOString();
}

export function createReminderAutomation(db, input = {}) {
  const actor = assertAuthority(db, input.created_by ?? input.decided_by ?? "local_creator", "goal.own");
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("automation title is required");
  const scheduleKind = input.schedule_kind ?? "once";
  if (!["once", "daily"].includes(scheduleKind)) throw new Error("schedule_kind must be once or daily");
  const nextRunAt = validInstant(input.next_run_at, "next_run_at");
  const timezone = String(input.timezone ?? "Asia/Shanghai").trim();
  if (!timezone) throw new Error("timezone is required");
  const id = newId("automation"), stamp = now();
  db.prepare("INSERT INTO automations VALUES (?,?,?,?,?,?,'active',?,?,?)").run(id, title, scheduleKind, canonicalJson({ interval_days: scheduleKind === "daily" ? 1 : null }), timezone, nextRunAt, actor, stamp, stamp);
  db.prepare("INSERT INTO automation_event_log(automation_id,event_type,payload_json,created_at) VALUES (?,?,?,?)").run(id, "automation.created", canonicalJson({ schedule_kind: scheduleKind, next_run_at: nextRunAt }), stamp);
  appendEvent(db, "automation", id, "automation.created", { schedule_kind: scheduleKind, next_run_at: nextRunAt });
  return getAutomation(db, id);
}

export function getAutomation(db, automationId) {
  return decorate(db.prepare("SELECT * FROM automations WHERE automation_id=?").get(automationId));
}

export function listAutomations(db, { status = null } = {}) {
  const rows = status
    ? db.prepare("SELECT a.*,(SELECT COUNT(*) FROM automation_occurrences o WHERE o.automation_id=a.automation_id AND o.status='pending') pending_count FROM automations a WHERE a.status=? ORDER BY a.next_run_at").all(status)
    : db.prepare("SELECT a.*,(SELECT COUNT(*) FROM automation_occurrences o WHERE o.automation_id=a.automation_id AND o.status='pending') pending_count FROM automations a ORDER BY CASE a.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,a.next_run_at").all();
  return rows.map(decorate);
}

export function setAutomationStatus(db, automationId, { status, decided_by = "local_creator" } = {}) {
  const actor = assertAuthority(db, decided_by, "goal.own");
  if (!["active", "paused"].includes(status)) throw new Error("automation status must be active or paused");
  const row = getAutomation(db, automationId);
  if (!row) throw new Error("automation not found");
  if (row.status === "completed") throw new Error("completed automation cannot be resumed");
  const stamp = now();
  db.prepare("UPDATE automations SET status=?,updated_at=? WHERE automation_id=?").run(status, stamp, automationId);
  db.prepare("INSERT INTO automation_event_log(automation_id,event_type,payload_json,created_at) VALUES (?,?,?,?)").run(automationId, `automation.${status}`, canonicalJson({ decided_by: actor }), stamp);
  appendEvent(db, "automation", automationId, `automation.${status}`, { decided_by: actor });
  return getAutomation(db, automationId);
}

export function runDueAutomations(db, { at = now() } = {}) {
  const boundary = validInstant(at, "at");
  return atomic(db, () => {
    const due = db.prepare("SELECT * FROM automations WHERE status='active' AND next_run_at<=? ORDER BY next_run_at,automation_id").all(boundary);
    const fired = [];
    for (const row of due) {
      const occurrenceId = newId("occurrence"), stamp = now();
      const inserted = db.prepare("INSERT OR IGNORE INTO automation_occurrences VALUES (?,?,?,?,'pending',NULL,NULL)").run(occurrenceId, row.automation_id, row.next_run_at, stamp);
      const nextRunAt = row.schedule_kind === "daily" ? nextDailyRun(row.next_run_at, boundary) : row.next_run_at;
      const status = row.schedule_kind === "daily" ? "active" : "completed";
      db.prepare("UPDATE automations SET next_run_at=?,status=?,updated_at=? WHERE automation_id=?").run(nextRunAt, status, stamp, row.automation_id);
      if (!inserted.changes) continue;
      db.prepare("INSERT INTO automation_event_log(automation_id,event_type,payload_json,created_at) VALUES (?,?,?,?)").run(row.automation_id, "automation.fired", canonicalJson({ occurrence_id: occurrenceId, scheduled_for: row.next_run_at }), stamp);
      appendEvent(db, "automation", row.automation_id, "automation.fired", { occurrence_id: occurrenceId, scheduled_for: row.next_run_at });
      fired.push({ occurrence_id: occurrenceId, automation_id: row.automation_id, title: row.title, scheduled_for: row.next_run_at, fired_at: stamp, status: "pending" });
    }
    return fired;
  });
}

export function listPendingReminders(db) {
  return db.prepare(`SELECT o.occurrence_id,o.automation_id,o.scheduled_for,o.fired_at,o.status,a.title,a.schedule_kind,a.timezone
    FROM automation_occurrences o JOIN automations a ON a.automation_id=o.automation_id
    WHERE o.status='pending' ORDER BY o.scheduled_for`).all();
}

export function acknowledgeReminder(db, occurrenceId, { decided_by = "local_creator" } = {}) {
  const actor = assertAuthority(db, decided_by, "goal.own");
  const row = db.prepare("SELECT * FROM automation_occurrences WHERE occurrence_id=?").get(occurrenceId);
  if (!row) throw new Error("automation occurrence not found");
  if (row.status !== "pending") return { ...row, idempotent: true };
  const stamp = now();
  db.prepare("UPDATE automation_occurrences SET status='acknowledged',acknowledged_at=?,acknowledged_by=? WHERE occurrence_id=?").run(stamp, actor, occurrenceId);
  db.prepare("INSERT INTO automation_event_log(automation_id,event_type,payload_json,created_at) VALUES (?,?,?,?)").run(row.automation_id, "automation.acknowledged", canonicalJson({ occurrence_id: occurrenceId, decided_by: actor }), stamp);
  appendEvent(db, "automation", row.automation_id, "automation.acknowledged", { occurrence_id: occurrenceId, decided_by: actor });
  return db.prepare("SELECT * FROM automation_occurrences WHERE occurrence_id=?").get(occurrenceId);
}
