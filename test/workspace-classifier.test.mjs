import test from "node:test";
import assert from "node:assert/strict";
import { classifyWorkspace, WORKSPACES } from "../src/product/workspace-classifier.mjs";

test("workspace contract exposes the seven product views and transitional Inbox", () => {
  assert.deepEqual(WORKSPACES, [
    "today",
    "projects",
    "life",
    "relationships",
    "knowledge",
    "evolution",
    "activity",
    "inbox",
  ]);
});

test("project content stays in Projects even when it happened today", () => {
  const result = classifyWorkspace("今天高校项目进入专家确认阶段", {
    analysis: { domains: ["project"], time_layers: ["current"] },
    source: "agenthub",
  });
  assert.equal(result.workspace, "projects");
  assert.equal(result.status, "classified");
  assert.match(result.reason_codes[0], /content_workspace_overrides_attention_view|workspace_rule_match/);
});

test("Today is reserved for attention and decision questions", () => {
  const result = classifyWorkspace("今天我最应该优先做什么？");
  assert.equal(result.workspace, "today");
  assert.equal(result.status, "classified");
});

test("mixed work and life input remains in Inbox until it is separated", () => {
  const result = classifyWorkspace("项目今晚要交付，但我需要陪家人去医院", {
    analysis: { domains: ["project", "life"] },
  });
  assert.equal(result.workspace, "inbox");
  assert.equal(result.status, "needs_creator_confirmation");
  assert.deepEqual(result.candidates.sort(), ["life", "projects", "relationships"].sort());
});

test("system execution evidence is Activity while learned rules are Evolution", () => {
  assert.equal(classifyWorkspace("查看 Agent 的超时重试和验证结果").workspace, "activity");
  assert.equal(classifyWorkspace("记住这次失败的教训，下次不要重复").workspace, "evolution");
});
