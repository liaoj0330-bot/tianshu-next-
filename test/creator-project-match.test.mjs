import assert from "node:assert/strict";
import { test } from "node:test";
import { matchCreatorProject } from "../src/creator/project-match.mjs";

const portfolio = [
  { project_key: "tianshu", display_name: "天枢个人AI工作操作系统", execution_policy: "eligible_after_approval", status: "active" },
  { project_key: "protected_ppt_capability", display_name: "受保护PPT能力线", execution_policy: "no_access", status: "protected" },
];

test("matches only explicit SQLite project identity and never enables execution", () => {
  const result = matchCreatorProject("继续推进天枢个人AI工作操作系统", portfolio);
  assert.equal(result.status, "matched");
  assert.equal(result.project.project_key, "tianshu");
  assert.equal(result.execution_allowed, false);
});

test("blocks no_access project even when explicitly matched", () => {
  const result = matchCreatorProject("检查受保护PPT能力线", portfolio);
  assert.equal(result.status, "blocked");
  assert.equal(result.execution_allowed, false);
});

test("does not guess a project from generic domain keywords", () => {
  const result = matchCreatorProject("做一个高校项目的视觉方案", portfolio);
  assert.equal(result.status, "unresolved");
  assert.deepEqual(result.candidates, []);
});