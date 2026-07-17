import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import { QUANT_ACCEPTANCE_INPUT } from "./fixtures/quant-material-acceptance.mjs";

async function post(base, path, payload) {
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("the real 11-source AgentHub scenario preserves every source and stops at understanding confirmation", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-agenthub-material-acceptance-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  const address = await gateway.listen();
  const base = `http://${address.address}:${address.port}`;

  try {
    const response = await post(base, "/v1/channels/agenthub/messages", {
      message: QUANT_ACCEPTANCE_INPUT,
      conversation_id: "quant-new-version-acceptance",
      message_id: "quant-materials-11-v1",
      idempotency_key: "quant-materials-11-v1",
      actor_id: "local_creator",
      actor_kind: "creator",
      metadata: { context_kind: "product", acceptance_scenario: "bulk_material_project_alignment" },
    });
    assert.equal(response.status, 202);
    const result = await response.json();
    const brief = result.interaction.project_brief;

    assert.equal(result.interaction.mode, "project_intake");
    assert.equal(result.interaction.fulfillment_status, "awaiting_user_input");
    assert.equal(result.interaction.phase, "needs_one_answer");
    assert.equal(result.interaction.material_receipt.submitted_count, 11);
    assert.equal(result.interaction.material_receipt.registered_count, 11);
    assert.equal(result.interaction.material_receipt.issue_count, 0);
    assert.equal(result.interaction.material_receipt.order_preserved, true);
    assert.equal(result.interaction.material_receipt.source_preserved, true);
    assert.equal(result.interaction.material_receipt.submitted_original_preserved, true);
    assert.equal(result.interaction.material_receipt.external_content_fetched, false);
    assert.equal(result.interaction.current_question.key, "audience");
    assert.equal(result.workspace_assignment.effective_workspace, "projects");
    assert.equal(result.workspace_assignment.status, "classified");
    assert.equal(result.materials.length, 11);
    assert.equal(brief.materials.length, 11);
    assert.equal(new Set(brief.materials.map((item) => item.locator)).size, 11);
    assert.ok(brief.materials.every((item) => item.kind === "link" && item.source === "douyin"));
    assert.match(brief.materials[0].name, /老李AI实战/);
    assert.match(brief.materials[10].name, /未来奇点/);
    assert.deepEqual(brief.requested_outcomes, ["资料核验", "需求澄清", "风险边界", "最小可行方案"]);
    assert.deepEqual(brief.prohibited_actions, ["自动交易", "资金操作", "直接实盘"]);
    assert.equal(brief.project_proposal.project_key, "ai_quant_system");
    assert.equal(brief.project_proposal.lane, "secondary_project");
    assert.equal(brief.project_proposal.explicitly_requested, true);

    assert.match(result.assistant_message.text, /11 项材料/);
    assert.match(result.assistant_message.text, /只确认一个关键问题/);
    assert.equal(result.assistant_message.card.kind, "materials_received");
    assert.equal(result.assistant_message.card.display_title, "已收到素材");
    assert.equal(result.assistant_message.card.stage_label, "还需要你确认一件事");
    assert.equal(result.assistant_message.card.material_count, 11);
    assert.equal(result.assistant_message.confirmation, null);
    assert.equal(result.assistant_message.requires_creator_confirmation, false);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM material_dialogues WHERE status='awaiting_answer'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_candidates").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM runs").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM jobs").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_runs").get().count, 0);

    const today = await fetch(base + "/v1/today").then((item) => item.json());
    assert.equal(today.recent_records[0].materials.length, 11);
    assert.equal(today.recent_records[0].material_receipt.registered_count, 11);
    assert.equal(today.recent_records[0].current_question.key, "audience");
    assert.equal(today.material_conversations.awaiting_answer, 1);
    assert.equal(today.confirmations.length, 0);

    const agentHubPage = await fetch(base + "/agenthub");
    assert.equal(agentHubPage.status, 200);
    const html = await agentHubPage.text();
    assert.match(html, /添加材料/);
    assert.match(html, /我目前的理解/);
    assert.match(html, /发送给 AgentHub/);
    assert.match(html, /单次最多登记 100 份材料/);

    const clarificationResponse = await post(base, "/v1/channels/agenthub/messages", {
      message: "这是给客户做需求判断和方案建议，不是替客户自动交易。",
      conversation_id: "quant-new-version-acceptance",
      message_id: "quant-materials-11-answer-v1",
      idempotency_key: "quant-materials-11-answer-v1",
      actor_id: "local_creator",
      actor_kind: "creator",
      metadata: { context_kind: "product", acceptance_scenario: "bulk_material_project_alignment" },
    });
    assert.equal(clarificationResponse.status, 202);
    const clarified = await clarificationResponse.json();
    assert.equal(clarified.interaction.mode, "material_clarification");
    assert.equal(clarified.interaction.phase, "understanding_ready");
    assert.equal(clarified.interaction.fulfillment_status, "awaiting_creator_confirmation");
    assert.equal(clarified.interaction.project_brief.materials.length, 11);
    assert.equal(clarified.interaction.clarifications.length, 1);
    assert.match(clarified.interaction.clarifications[0].answer, /给客户/);
    assert.equal(clarified.assistant_message.card.kind, "understanding_summary");
    assert.equal(clarified.assistant_message.card.display_title, "我目前的理解");
    assert.equal(clarified.assistant_message.requires_creator_confirmation, true);
    assert.equal(clarified.assistant_message.confirmation, null);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM material_dialogues WHERE status='understanding_ready'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_candidates").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM material_dialogue_turns").get().count, 2);

    const sessionId = result.interaction_contract.session_id;
    const session = await fetch(base + `/v1/channels/agenthub/sessions/${sessionId}`).then((item) => item.json());
    assert.equal(session.requests.length, 2);
    assert.equal(session.requests[0].input.message, QUANT_ACCEPTANCE_INPUT);
    assert.equal(session.requests[0].response.assistant_message.card.kind, "materials_received");
    assert.match(session.requests[1].input.message, /给客户/);
    assert.equal(session.requests[1].response.assistant_message.card.kind, "understanding_summary");

    const afterClarification = await fetch(base + "/v1/today").then((item) => item.json());
    assert.equal(afterClarification.material_conversations.awaiting_answer, 0);
    assert.equal(afterClarification.material_conversations.awaiting_understanding_confirmation, 1);
    assert.equal(afterClarification.confirmations.length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM runs").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM jobs").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_runs").get().count, 0);

    const understandingDecision = await post(base, `/v1/material-dialogues/${clarified.interaction.material_dialogue_id}/understanding-decision`, {
      decision: "confirm",
      decided_by: "local_creator",
    });
    const researchReady = await understandingDecision.json();
    assert.equal(understandingDecision.status, 200, JSON.stringify(researchReady));
    assert.equal(researchReady.dialogue.phase, "closed");
    assert.equal(researchReady.dialogue.status, "closed");
    assert.ok(researchReady.plan_candidate?.candidate_id);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_candidates").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM goals").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM runs").get().count, 0);

    const afterUnderstandingDecision = await fetch(base + "/v1/today").then((item) => item.json());
    assert.ok(afterUnderstandingDecision.confirmations.some((item) => item.type === "plan" && item.confirmation_id === researchReady.plan_candidate.candidate_id));

    const planDecision = await post(base, `/v1/intakes/${researchReady.plan_candidate.intake_id}/plan-decision`, {
      decision: "approve",
      decided_by: "local_creator",
    });
    assert.equal(planDecision.status, 200);
    const prepared = await planDecision.json();
    assert.equal(prepared.status, "prepared_not_approved");
    assert.equal(prepared.execution_started, false);
    assert.ok(prepared.goal_id);
    assert.ok(prepared.plan_id);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM runs").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_runs").get().count, 0);
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a mixed AgentHub batch preserves type, order, source, and original attachment content", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-agenthub-mixed-materials-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  const address = await gateway.listen();
  const base = `http://${address.address}:${address.port}`;
  const materials = [
    { attachment_id: "text-1", kind: "text", name: "客户说明.md", media_type: "text/markdown", size_bytes: 30, text_content: "客户要先完成需求判断，不要直接执行。" },
    { attachment_id: "image-2", kind: "image", name: "现场截图.png", media_type: "image/png", size_bytes: 2, content_data_url: "data:image/png;base64,AA==" },
    { attachment_id: "audio-3", kind: "audio", name: "客户访谈.m4a", media_type: "audio/mp4", size_bytes: 2, content_data_url: "data:audio/mp4;base64,AQ==" },
    { attachment_id: "video-4", kind: "video", name: "演示录像.mp4", media_type: "video/mp4", size_bytes: 2, content_data_url: "data:video/mp4;base64,Ag==" },
    { attachment_id: "document-5", kind: "document", name: "需求书.pdf", media_type: "application/pdf", size_bytes: 2, content_data_url: "data:application/pdf;base64,Aw==" },
    { attachment_id: "sheet-6", kind: "spreadsheet", name: "数据样例.xlsx", media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 2, content_data_url: "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,BA==" },
  ];

  try {
    const response = await post(base, "/v1/channels/agenthub/messages", {
      message: "先看项目说明 https://example.com/project ，再看客户来源 https://v.douyin.com/source/ 。这一批先整理和反问，不要执行。",
      materials,
      conversation_id: "mixed-material-acceptance",
      message_id: "mixed-material-acceptance-v1",
      idempotency_key: "mixed-material-acceptance-v1",
      actor_id: "local_creator",
      actor_kind: "creator",
      metadata: { context_kind: "product", acceptance_scenario: "mixed_bulk_materials" },
    });
    assert.equal(response.status, 202);
    const result = await response.json();
    const briefMaterials = result.interaction.project_brief.materials;
    const receiptItems = result.interaction.material_receipt.items;

    assert.equal(result.interaction.material_receipt.submitted_count, 8);
    assert.equal(result.interaction.material_receipt.registered_count, 8);
    assert.equal(result.interaction.material_receipt.order_preserved, true);
    assert.deepEqual(briefMaterials.map((item) => item.kind), ["link", "link", "text", "image", "audio", "video", "document", "spreadsheet"]);
    assert.deepEqual(briefMaterials.map((item) => item.source), ["example.com", "douyin", ...Array(6).fill("agenthub_attachment")]);
    assert.deepEqual(briefMaterials.slice(2).map((item) => item.submitted_position), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(receiptItems.map((item) => item.position), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(result.materials.some((item) => "text_content" in item || "content_data_url" in item), false);

    const stored = JSON.parse(db.prepare("SELECT payload_json FROM intake_events WHERE intake_id=?").get(result.intake_id).payload_json);
    assert.deepEqual(stored.materials.map((item) => item.attachment_id), materials.map((item) => item.attachment_id));
    assert.equal(stored.materials[0].text_content, materials[0].text_content);
    assert.equal(stored.materials[1].content_data_url, materials[1].content_data_url);
    assert.equal(stored.materials[5].content_data_url, materials[5].content_data_url);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_candidates").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM runs").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_runs").get().count, 0);
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
