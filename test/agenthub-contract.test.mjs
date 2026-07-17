import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import {
  getAgentHubSession,
  getAgentHubToday,
  sendAgentHubMessage,
} from "../src/gateway/agenthub-adapter.mjs";
import { createGateway } from "../src/gateway/server.mjs";

test("AgentHub messages are idempotent, creator-bound, and recoverable after restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-agenthub-"));
  const statePath = join(root, "state.sqlite");
  let db = openStore(statePath);
  let gateway = createGateway({ db });
  try {
    let address = await gateway.listen();
    let base = `http://${address.address}:${address.port}`;
    const options = {
      conversationId: "conversation-001",
      messageId: "message-001",
      idempotencyKey: "idempotency-001",
      metadata: { client: "agenthub-contract-test" },
    };

    const accepted = await sendAgentHubMessage(base, "我刚刚想到了一件事", options);
    assert.equal(accepted.interaction_contract.replayed, false);
    assert.equal(accepted.interaction_contract.actor_claim.actor_id, "local_creator");
    assert.equal(accepted.interaction_contract.actor_claim.actor_kind, "creator");
    assert.equal(accepted.interaction_contract.agenthub_can_confirm, false);
    assert.equal(accepted.interaction_contract.agenthub_can_execute, false);
    assert.equal(accepted.interaction_contract.authentication, "trusted_agenthub_boundary_required");
    assert.equal(accepted.interaction_contract.cockpit_route, "/agenthub");
    assert.equal(
      accepted.interaction_contract.confirmation_link_template,
      "/agenthub?confirmation=:confirmation_id",
    );
    assert.equal(typeof accepted.assistant_message.text, "string");
    assert.ok(accepted.assistant_message.text.length > 0);
    assert.equal(typeof accepted.assistant_message.requires_creator_confirmation, "boolean");
    assert.equal(typeof accepted.assistant_message.fulfillment_status, "string");
    assert.equal(typeof accepted.assistant_message.next_action, "string");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM intake_events").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM interaction_requests").get().count, 1);

    const replay = await sendAgentHubMessage(base, "我刚刚想到了一件事", options);
    assert.equal(replay.interaction_contract.replayed, true);
    assert.equal(replay.intake_id, accepted.intake_id);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM intake_events").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM interaction_requests").get().count, 1);

    await assert.rejects(
      sendAgentHubMessage(base, "相同标识不能代表另一条消息", options),
      (error) => error.statusCode === 409 && /already used/.test(error.message),
    );
    await assert.rejects(
      sendAgentHubMessage(base, "试图冒充奈奈", {
        ...options,
        conversationId: "conversation-unauthorized",
        messageId: "message-unauthorized",
        idempotencyKey: "idempotency-unauthorized",
        actorId: "agenthub",
        actorKind: "system",
      }),
      (error) => error.statusCode === 403 && /authenticated local creator/.test(error.message),
    );

    const sessionId = accepted.interaction_contract.session_id;
    const session = await getAgentHubSession(base, sessionId);
    assert.equal(session.requests.length, 1);
    assert.equal(session.requests[0].status, "accepted");
    assert.equal(session.requests[0].intake_id, accepted.intake_id);
    assert.equal(session.authority.creator_id, "local_creator");
    assert.equal(session.authority.agenthub_can_confirm, false);
    assert.equal(session.authority.agenthub_can_execute, false);
    assert.equal(session.today.decision_authority, "local_creator");
    assert.equal(session.today.surface_contract.read_only, true);

    const today = await getAgentHubToday(base);
    assert.equal(today.surface_contract.surface, "today");
    assert.equal(today.surface_contract.agenthub.can_submit, true);
    assert.equal(today.surface_contract.agenthub.can_confirm, false);
    assert.equal(today.surface_contract.agenthub.can_execute, false);
    assert.equal(today.surface_contract.agenthub.cockpit_route, "/agenthub");

    await gateway.close();
    db.close();
    gateway = null;
    db = openStore(statePath);
    gateway = createGateway({ db });
    address = await gateway.listen();
    base = `http://${address.address}:${address.port}`;

    const restored = await getAgentHubSession(base, sessionId);
    assert.equal(restored.session.status, "active");
    assert.equal(restored.requests.length, 1);
    assert.equal(restored.requests[0].intake_id, accepted.intake_id);

    const replayAfterRestart = await sendAgentHubMessage(base, "我刚刚想到了一件事", options);
    assert.equal(replayAfterRestart.interaction_contract.replayed, true);
    assert.equal(replayAfterRestart.intake_id, accepted.intake_id);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM intake_events").get().count, 1);
  } finally {
    await gateway?.close();
    db?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
