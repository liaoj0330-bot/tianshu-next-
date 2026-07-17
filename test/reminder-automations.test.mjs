import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { acknowledgeReminder, createReminderAutomation, listAutomations, listPendingReminders, runDueAutomations, setAutomationStatus } from "../src/automation/reminders.mjs";
import { createGateway } from "../src/gateway/server.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tianshu-automations-"));
  const db = openStore(join(root, "state.sqlite"));
  return { db, close() { db.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("one-time reminder fires once, persists, and requires creator acknowledgement", () => {
  const fx = fixture();
  try {
    const automation = createReminderAutomation(fx.db, { title: "查看今日唯一交付", schedule_kind: "once", next_run_at: "2026-07-16T01:00:00.000Z", created_by: "local_creator" });
    assert.equal(automation.status, "active");
    const fired = runDueAutomations(fx.db, { at: "2026-07-16T01:01:00.000Z" });
    assert.equal(fired.length, 1);
    assert.equal(runDueAutomations(fx.db, { at: "2026-07-16T01:02:00.000Z" }).length, 0);
    assert.equal(listAutomations(fx.db)[0].status, "completed");
    assert.equal(listPendingReminders(fx.db).length, 1);
    const acknowledged = acknowledgeReminder(fx.db, fired[0].occurrence_id, { decided_by: "local_creator" });
    assert.equal(acknowledged.status, "acknowledged");
    assert.equal(listPendingReminders(fx.db).length, 0);
  } finally { fx.close(); }
});

test("daily reminder advances beyond the scan boundary and pause is creator-controlled", () => {
  const fx = fixture();
  try {
    const automation = createReminderAutomation(fx.db, { title: "晚间回顾", schedule_kind: "daily", next_run_at: "2026-07-14T14:00:00.000Z" });
    const fired = runDueAutomations(fx.db, { at: "2026-07-16T01:00:00.000Z" });
    assert.equal(fired.length, 1);
    const current = listAutomations(fx.db)[0];
    assert.equal(current.status, "active");
    assert.equal(current.next_run_at, "2026-07-16T14:00:00.000Z");
    assert.equal(setAutomationStatus(fx.db, automation.automation_id, { status: "paused" }).status, "paused");
    assert.throws(() => setAutomationStatus(fx.db, automation.automation_id, { status: "active", decided_by: "agenthub" }), /not authorized/);
  } finally { fx.close(); }
});

test("reminder API exposes the SQLite lifecycle to product surfaces", async () => {
  const fx = fixture(); const gateway = createGateway({ db: fx.db }); const address = await gateway.listen();
  const base = `http://${address.address}:${address.port}`;
  try {
    const createdResponse = await fetch(base + "/v1/automations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "整点检查", schedule_kind: "once", next_run_at: "2026-07-16T01:00:00.000Z", decided_by: "local_creator" }) });
    assert.equal(createdResponse.status, 201);
    runDueAutomations(fx.db, { at: "2026-07-16T01:01:00.000Z" });
    const today = await fetch(base + "/v1/today").then((response) => response.json());
    assert.equal(today.reminders.length, 1);
    assert.equal(today.automation_summary.pending_reminders, 1);
    const acknowledged = await fetch(base + `/v1/automation-occurrences/${today.reminders[0].occurrence_id}/acknowledge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decided_by: "local_creator" }) });
    assert.equal(acknowledged.status, 200);
    assert.equal((await fetch(base + "/v1/today").then((response) => response.json())).reminders.length, 0);
  } finally { await gateway.close(); fx.close(); }
});
