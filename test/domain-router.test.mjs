import test from "node:test";
import assert from "node:assert/strict";
import { classifyOperatingDomain } from "../src/intelligence/domain-router.mjs";

test("keeps mixed work and life records conceptually separate", () => {
  assert.equal(classifyOperatingDomain({ domains: ["project", "life"] }), "mixed_with_separate_records");
  assert.equal(classifyOperatingDomain({ domains: ["life"] }), "life");
  assert.equal(classifyOperatingDomain({ domains: ["project"] }), "work");
});
