import assert from "node:assert/strict";
import test from "node:test";
import { classifyLegacyRecord } from "../src/product/legacy-context-classifier.mjs";

test("legacy classifier separates only explicit development and acceptance evidence", () => {
  assert.equal(classifyLegacyRecord({ source: "agenthub", text: "手机问答验收：状态来源是什么" }).context_kind, "acceptance");
  assert.equal(classifyLegacyRecord({ source: "agenthub-dev", text: "建立计划" }).context_kind, "development");
  assert.equal(classifyLegacyRecord({ source: "agenthub", text: "白名单项目工作区发生 Git 变化" }).context_kind, "development");
  assert.equal(classifyLegacyRecord({ source: "agenthub", text: "今天需要推进产品身份模型" }), null);
});
