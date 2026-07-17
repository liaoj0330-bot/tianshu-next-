import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import { createStateSubject } from "../src/state/dynamic-state.mjs";
import { assessCreatorProject, upsertCreatorProjectBaseline } from "../src/creator/project-priority.mjs";

async function withJourney(work) {
  const root = mkdtempSync(join(tmpdir(), "tianshu-alpha-journey-"));
  const db = openStore(join(root, "state.sqlite"));
  createStateSubject(db, { subject_id: "creator", display_name: "奈奈", initial_state: { stable: { mission: "高校AI教育体系与产教融合" }, current: {}, future: {} }, source: { type: "creator_explicit" } });
  upsertCreatorProjectBaseline(db, { source: { kind: "creator_explicit", reference: "test", version: "1" }, projects: [{ project_key: "tianshu", display_name: "天枢个人 AI 工作操作系统", lane: "main", baseline_priority: 5, execution_policy: "eligible_after_approval", status: "active", evidence: [] }] });
  assessCreatorProject(db, "tianshu", { factors: { mission_alignment: 5, system_asset_leverage: 5, time_window: 4, evidence_quality: 4, dependency_urgency: 4, resource_pressure: 1 }, source: { kind: "test", reference: "score" } });
  const gateway = createGateway({ db }); const address = await gateway.listen(); const base = `http://${address.address}:${address.port}`;
  try { await work({ db, base }); } finally { await gateway.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
}

const post = (base, path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("real user question returns a grounded answer instead of a route label", async () => withJourney(async ({ base }) => {
  const response = await post(base, "/v1/intake", { source: "agenthub-dev", message: "你觉得我今天最应该推进什么？" });
  const result = await response.json();
  assert.equal(result.interaction.mode, "direct_answer");
  assert.equal(result.interaction.completed, true);
  assert.equal(result.interaction.fulfillment_status, "answered");
  assert.match(result.interaction.answer.judgment, /天枢个人 AI 工作操作系统/);
  assert.ok(result.interaction.answer.evidence.length >= 2);
}));

test("messy project materials become an evidence-bounded alignment card", async () => withJourney(async ({ db, base }) => {
  const message = "客户的 AI 量化资料\n收益 60%+ https://v.douyin.com/a/\n幸存者偏差 https://v.douyin.com/b/";
  const intake = await (await post(base, "/v1/intake", { source: "agenthub-dev", message })).json();
  assert.equal(intake.interaction.mode, "project_intake");
  assert.equal(intake.interaction.fulfillment_status, "awaiting_creator_confirmation");
  assert.equal(intake.interaction.project_brief.title, "AI 量化系统");
  assert.equal(intake.interaction.plan_candidate.project_brief.unverified_claims[0].status, "unverified");
  assert.match(intake.interaction.plan_candidate.alignment_summary, /首轮只读调研/);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 0);
  const today = await fetch(base + "/v1/today").then((response) => response.json());
  const card = today.confirmations.find((item) => item.confirmation_id === intake.interaction.plan_candidate.candidate_id);
  assert.equal(card.result.interaction.mode, "project_alignment");
  assert.match(card.effects.join(" "), /不会立即开发/);
}));

test("action creates no task until creator confirms the visible candidate", async () => withJourney(async ({ db, base }) => {
  const intake = await (await post(base, "/v1/intake", { source: "agenthub-dev", message: "帮我整理今天三个项目的优先级，并给出每个判断的证据" })).json();
  assert.equal(intake.interaction.mode, "action_proposal");
  assert.equal(intake.interaction.fulfillment_status, "awaiting_creator_confirmation");
  assert.ok(intake.interaction.plan_candidate.completion_criteria.length >= 3);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 0);
  const approvedResponse = await post(base, `/v1/intakes/${intake.intake_id}/plan-decision`, { decision: "approve", decided_by: "creator" });
  const approved = await approvedResponse.json();
  assert.equal(approved.status, "prepared_not_approved");
  assert.equal(approved.execution_started, false);
  assert.equal(approved.task_id, null);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 0);
  assert.equal(db.prepare("SELECT status FROM plans WHERE plan_id=?").get(approved.plan_id).status, "awaiting_approval");
  let confirmations = await fetch(base + "/v1/confirmations").then((response) => response.json());
  assert.ok(confirmations.items.some((item) => item.confirmation_id === approved.plan_id && item.type === "execution_configuration"));
  const invalidBoundary = await post(base, `/v1/plans/${approved.plan_id}/execution-boundary`, { executor_agent: "codex", verifier_agent: "codex", allowed_paths: [process.cwd()], timeout_ms: 300000, max_attempts: 2 });
  assert.equal(invalidBoundary.status, 400);
  const configured = await (await post(base, `/v1/plans/${approved.plan_id}/execution-boundary`, { executor_agent: "codex", verifier_agent: "claude", allowed_paths: [process.cwd()], timeout_ms: 300000, max_attempts: 2 })).json();
  assert.equal(configured.boundary.executor_agent, "codex");
  confirmations = await fetch(base + "/v1/confirmations").then((response) => response.json());
  assert.ok(confirmations.items.some((item) => item.confirmation_id === approved.plan_id && item.type === "execution"));
  const execution = await (await post(base, `/v1/plans/${approved.plan_id}/execution-decision`, { decision: "approve", decided_by: "creator" })).json();
  assert.equal(execution.status, "execution_approved_not_started");
  assert.equal(execution.execution_started, false);
  assert.equal(db.prepare("SELECT status FROM tasks WHERE task_id=?").get(execution.task_id).status, "approved");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM runs").get().count, 0);
  const duplicate = await post(base, `/v1/intakes/${intake.intake_id}/plan-decision`, { decision: "approve" });
  assert.equal(duplicate.status, 409);
}));
test("pending confirmation survives page refresh and disappears after decision", async () => withJourney(async ({ base }) => {
  const intake = await (await post(base, "/v1/intake", { source: "agenthub-dev", message: "帮我整理项目优先级并给出证据" })).json();
  const pending = await fetch(base + "/v1/confirmations").then((response) => response.json());
  assert.ok(pending.items.some((item) => item.confirmation_id === intake.interaction.plan_candidate.candidate_id && item.type === "plan"));
  await post(base, `/v1/intakes/${intake.intake_id}/plan-decision`, { decision: "reject" });
  const after = await fetch(base + "/v1/confirmations").then((response) => response.json());
  assert.equal(after.items.some((item) => item.confirmation_id === intake.interaction.plan_candidate.candidate_id), false);
}));
test("plan revision supersedes the old version and only the new version remains confirmable", async () => withJourney(async ({ db, base }) => {
  const intake = await (await post(base, "/v1/intake", { source: "agenthub-dev", message: "帮我整理项目优先级并给出证据" })).json();
  const first = intake.interaction.plan_candidate;
  const revised = await (await post(base, `/v1/plan-candidates/${first.candidate_id}/revise`, { revision_note: "增加风险说明，并限制在天枢范围" })).json();
  assert.equal(revised.candidate.version, 2);
  assert.equal(revised.candidate.supersedes_id, first.candidate_id);
  assert.equal(db.prepare("SELECT status FROM plan_candidates WHERE candidate_id=?").get(first.candidate_id).status, "superseded");
  const pending = await fetch(base + "/v1/confirmations").then((response) => response.json());
  assert.equal(pending.items.some((item) => item.confirmation_id === first.candidate_id), false);
  assert.ok(pending.items.some((item) => item.confirmation_id === revised.candidate.candidate_id));
}));
