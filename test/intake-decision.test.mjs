import assert from "node:assert/strict";
import { test } from "node:test";
import { decideIntakeInteraction } from "../src/intelligence/intake-decision.mjs";

test("bare materials become a project discovery intake instead of pushing intent back to creator", () => {
  const result = decideIntakeInteraction("https://example.com/reference", { confidence: "low" });
  assert.equal(result.mode, "project_intake");
  assert.equal(result.next_action, "prepare_project_alignment");
  assert.equal(result.approval_required, true);
  assert.equal(result.execution_allowed, false);
});

test("a bundle of links is organized before creator alignment", () => {
  const result = decideIntakeInteraction("资料一 https://example.com/a\n资料二 https://example.com/b", { confidence: "low" });
  assert.equal(result.mode, "project_intake");
  assert.deepEqual(result.reason_codes, ["material_bundle", "project_discovery_required"]);
});

test("possible changes become candidates and never overwrite state directly", () => {
  const result = decideIntakeInteraction("今天高校项目进入专家确认阶段", { confidence: "medium" });
  assert.equal(result.mode, "state_candidate");
  assert.equal(result.next_action, "compare_with_current_state");
  assert.equal(result.execution_allowed, false);
});

test("controlled actions require an approval-bound plan", () => {
  const result = decideIntakeInteraction("请给合作方发消息并创建任务", { confidence: "medium" });
  assert.equal(result.mode, "dispatch_request");
  assert.equal(result.approval_required, true);
  assert.equal(result.next_action, "prepare_approval_bound_plan");
});

test("questions remain answers rather than automatically creating tasks", () => {
  const result = decideIntakeInteraction("你觉得我现在最应该推进什么？", { confidence: "medium" });
  assert.equal(result.mode, "direct_answer");
  assert.equal(result.approval_required, false);
});

test("creator corrections remain state candidates instead of generic uncertainty", () => {
  const result = decideIntakeInteraction("澳大利亚只是老师举的例子，不是我的真实项目", { confidence: "low", needs_questions: true });
  assert.equal(result.mode, "state_candidate");
  assert.equal(result.execution_allowed, false);
});

test("a just-finished meeting is recognized as a possible change", () => {
  const result = decideIntakeInteraction("刚才开完会，信息还比较乱", { confidence: "low", needs_questions: true });
  assert.equal(result.mode, "state_candidate");
});
