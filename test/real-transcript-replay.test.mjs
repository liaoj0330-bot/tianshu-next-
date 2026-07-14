import test from "node:test";
import assert from "node:assert/strict";
import { analyzeIntent } from "../src/intelligence/intent-router.mjs";
import { classifyOperatingDomain } from "../src/intelligence/domain-router.mjs";

test("creator transcript replay separates stable, current, future, work and life signals", () => {
  const cycles = [
    "我的身份和长期目标是高校教育体系与产教融合，项目优先级由事业主航道决定。",
    "最近澳大利亚合作发生重大变化，关键合作方开始推进政府内部事项，天枢不能继续只做宣发物料。",
    "未来希望手机、摄像头和语音设备每天收集信息，晚上主动总结并追问；工作和生活要分开管理但统一理解。",
  ].map((text) => ({ text, analysis: analyzeIntent(text) }));
  assert.equal(cycles[0].analysis.time_layers.includes("stable"), true);
  assert.equal(cycles[1].analysis.time_layers.includes("current"), true);
  assert.equal(cycles[2].analysis.time_layers.includes("future"), true);
  assert.equal(classifyOperatingDomain(cycles[1].analysis), "work");
  assert.equal(cycles[2].analysis.domains.includes("life"), true);
});
