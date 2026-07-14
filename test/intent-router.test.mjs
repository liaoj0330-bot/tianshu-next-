import test from "node:test";
import assert from "node:assert/strict";
import { analyzeIntent } from "../src/intelligence/intent-router.mjs";

test("routes long-term creator, current project, and future system signals", () => {
  const result = analyzeIntent("我的长期目标是高校教育，最近公司合作发生变化，未来天枢要接入手机和硬件，帮我判断下一步");
  assert.deepEqual(result.domains.sort(), ["creator", "project", "system"]);
  assert.deepEqual(result.time_layers.sort(), ["current", "future", "stable"]);
  assert.equal(result.intent_type, "action_or_decision");
});

test("marks incomplete state for targeted follow-up", () => {
  const result = analyzeIntent("最近项目变化很大，但我还不确定下一步怎么安排");
  assert.equal(result.needs_questions, true);
  assert.equal(result.action_signal, false);
});
