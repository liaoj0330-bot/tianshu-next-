import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCreatorSignals } from "../src/intelligence/creator-signal-extractor.mjs";

test("explicit fatigue becomes a current wellbeing candidate", () => {
  const extracted = extractCreatorSignals("我今天有点累，而且事情很多");
  assert.ok(extracted.signals.some((signal) => signal.path === "current.wellbeing.energy" && signal.value === "low"));
});

test("example-only correction does not recreate the removed Australia project rule", () => {
  const extracted = extractCreatorSignals("澳大利亚只是老师举的例子，不是我的真实项目");
  assert.equal(extracted.signals.some((signal) => signal.path.includes("australia")), false);
});