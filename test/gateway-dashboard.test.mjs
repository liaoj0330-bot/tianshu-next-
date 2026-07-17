import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";

test("cognitive cockpit is served by the same gateway as intake", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-dashboard-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  const address = await gateway.listen();
  try {
    const base = `http://${address.address}:${address.port}`;
    const page = await fetch(`${base}/agenthub`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /天枢 · 奈奈工作台/);
    assert.match(html, /data-view="today"/);
    assert.match(html, /data-view="projects"/);
    assert.match(html, /data-view="decision"/);
    assert.match(html, /data-view="action"/);
    assert.match(html, /data-view="evolution"/);
    assert.match(html, /最终决定：奈奈/);
    assert.match(html, /查看审计详情/);
    assert.match(html, /启动 Agent/);
    assert.match(html, /projectAlignmentDetails/);
    assert.match(html, /\/v1\/tasks\//);
    assert.match(html, /task_start/);
    assert.match(html, /新建提醒/);
    assert.match(html, /id="intake-materials"/);
    assert.match(html, /一次交过来/);
    assert.match(html, /建设进度/);
    assert.match(html, /材料是判断输入，不自动代表项目已开始建设/);
    assert.match(html, /customerLocator/);
    assert.match(html, /projectMaterialSummary/);
    assert.doesNotMatch(html, /<button id="mobile-intake-launch"/);
    assert.match(html, /先登记 → 一次反问一件事 → 你核对理解 → 再决定下一步/);
    assert.match(html, /toggleSpeechInput/);
    const browserScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    assert.ok(browserScript);
    assert.doesNotThrow(() => new Function(browserScript));
    const deepLink = await fetch(`${base}/agenthub?confirmation=first`);
    assert.equal(deepLink.status, 200);
    assert.match(await deepLink.text(), /奈奈确认/);
    const legacyDashboard = await fetch(`${base}/dashboard`);
    assert.equal(legacyDashboard.status, 404);

    const intake = await fetch(`${base}/v1/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "dashboard", message: "测试目标" }),
    });
    assert.equal(intake.status, 202);
    const intakeBody = await intake.json();
    assert.deepEqual(intakeBody.analysis.domains, ["uncategorized"]);
    const items = await fetch(`${base}/v1/intakes`).then((response) => response.json());
    assert.equal(items.items.length, 1);
    assert.equal(items.items[0].source, "dashboard");
    const overview = await fetch(`${base}/v1/overview`).then((response) => response.json());
    assert.equal(overview.control_plane, "tianshu-orchestrator");
    assert.equal(overview.counts.intakes, 1);
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("material attachments are preserved in SQLite and stop at creator confirmation", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-material-dashboard-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  const address = await gateway.listen();
  try {
    const base = "http://" + address.address + ":" + address.port;
    const response = await fetch(base + "/v1/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "dashboard",
        message: "",
        materials: [
          { kind: "text", name: "客户反馈.md", media_type: "text/markdown", size_bytes: 18, text_content: "客户希望搭建 AI 量化系统" },
          { kind: "image", name: "截图.png", media_type: "image/png", size_bytes: 12, content_data_url: "data:image/png;base64,AA==" },
          { kind: "audio", name: "访谈.m4a", media_type: "audio/mp4", size_bytes: 12, content_data_url: "data:audio/mp4;base64,AA==" },
        ],
      }),
    });
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.equal(result.interaction.mode, "project_intake");
    assert.equal(result.interaction.fulfillment_status, "awaiting_creator_confirmation");
    assert.equal(result.materials.length, 3);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 0);

    const stored = JSON.parse(db.prepare("SELECT payload_json FROM intake_events WHERE intake_id=?").get(result.intake_id).payload_json);
    assert.equal(stored.materials[0].text_content, "客户希望搭建 AI 量化系统");
    assert.match(stored.materials[1].content_data_url, /^data:image\/png;base64,/);
    assert.equal(stored.materials[1].content_status, "preserved_pending_vision");
    assert.equal(stored.materials[2].content_status, "preserved_pending_transcription");

    const today = await fetch(base + "/v1/today").then((item) => item.json());
    assert.equal(today.recent_records[0].materials.length, 3);
    assert.equal(today.recent_records[0].project_brief.title, "AI 量化系统");
    assert.ok(today.confirmations.some((item) => item.confirmation_id === result.interaction.plan_candidate.candidate_id));
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
