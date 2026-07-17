import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeMaterialBundle, extractMaterialItems, normalizeSubmittedMaterials } from "../src/intelligence/material-intake.mjs";

const sample = [
  "客户发来一批 AI 量化资料：",
  "AI 炒股收益 60%+ https://v.douyin.com/example-a/",
  "不要被幸存者偏差误导 https://v.douyin.com/example-b/",
  "Codex 做量化策略研究 https://example.com/quant",
].join("\n");

test("material bundle preserves individual sources and does not trust performance claims", () => {
  const materials = extractMaterialItems(sample);
  const brief = analyzeMaterialBundle(sample, { observed_at: "2026-07-16T00:00:00.000Z" });
  assert.equal(materials.length, 3);
  assert.equal(brief.title, "AI 量化系统");
  assert.equal(brief.judgment.priority, "next");
  assert.ok(brief.unverified_claims.some((item) => item.claim.includes("60%")));
  assert.ok(brief.uncertainties.some((item) => item.blocking_for_execution));
  assert.match(brief.judgment.recommendation, /首轮只读调研/);
  assert.match(brief.schedule.sequencing, /先核验材料/);
});

test("mixed inline materials preserve chronological order without duplicate extension matches", () => {
  const materials = extractMaterialItems("[Image #1]\nhttps://example.com/a.png\nD:\\inbox\\recording.mp3\n[录音 01]\n[File contract.pdf]");
  assert.deepEqual(materials.map((item) => item.kind), ["image", "link", "file", "audio", "file"]);
  assert.equal(materials.length, 5);
  assert.deepEqual(materials.map((item) => item.material_id), ["material_1", "material_2", "material_3", "material_4", "material_5"]);
});

test("submitted attachments preserve content status without pretending recognition completed", () => {
  const submitted = normalizeSubmittedMaterials([
    { kind: "text", name: "客户反馈.md", media_type: "text/markdown", size_bytes: 18, text_content: "客户希望搭建 AI 量化系统" },
    { kind: "image", name: "截图.png", media_type: "image/png", size_bytes: 12, content_data_url: "data:image/png;base64,AA==" },
    { kind: "audio", name: "录音.m4a", media_type: "audio/mp4", size_bytes: 12, content_data_url: "data:audio/mp4;base64,AA==" },
  ]);
  assert.deepEqual(submitted.map((item) => item.content_status), [
    "text_preserved",
    "preserved_pending_vision",
    "preserved_pending_transcription",
  ]);
  const brief = analyzeMaterialBundle("", { submitted_materials: submitted });
  assert.equal(brief.title, "AI 量化系统");
  assert.equal(brief.materials.filter((item) => item.source === "agenthub_attachment").length, 3);
  assert.ok(brief.uncertainties.some((item) => item.blocking_for_execution));
});
