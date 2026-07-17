import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import { recordWorkspaceAssignment } from "../src/product/workspace-assignment.mjs";

const VISIBLE_WORKSPACES = [
  "today",
  "projects",
  "life",
  "relationships",
  "knowledge",
  "evolution",
  "activity",
];

async function request(base, path, init = {}) {
  const response = await fetch(base + path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  return { status: response.status, body: await response.json() };
}

async function post(base, path, body) {
  return request(base, path, { method: "POST", body: JSON.stringify(body) });
}

test("product read models expose seven workspaces without becoming a second state authority", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-product-read-models-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  try {
    const address = await gateway.listen();
    const base = "http://" + address.address + ":" + address.port;

    const protectedImport = await post(base, "/v1/creator/portfolio/import", {
      source: { kind: "formal_creator_model", reference: "read-model-test", version: "1" },
      projects: [{
        project_key: "protected-secret",
        display_name: "Should not leak",
        lane: "protected",
        baseline_priority: 1,
        execution_policy: "no_access",
        status: "protected",
      }],
    });
    assert.equal(protectedImport.status, 201, JSON.stringify(protectedImport.body));

    const unresolved = await post(base, "/v1/intake", {
      source: "agenthub",
      message: "unclassified capture 9f3f",
    });
    assert.equal(unresolved.status, 202, JSON.stringify(unresolved.body));
    assert.equal(unresolved.body.workspace_assignment.effective_workspace, "inbox");
    assert.equal(unresolved.body.workspace_assignment.status, "unresolved");

    const creatorBeforeDecision = await request(base, "/v1/creator-model");
    const pending = creatorBeforeDecision.body.pending_workspace_confirmations.find(
      (item) => item.intake_id === unresolved.body.intake_id,
    );
    assert.ok(pending);
    assert.equal(pending.assignment.decision_state, "awaiting_creator_confirmation");

    const denied = await post(
      base,
      "/v1/intakes/" + unresolved.body.intake_id + "/workspace-decision",
      { decision: "correct", workspace: "life", decided_by: "agenthub" },
    );
    assert.equal(denied.status, 400);
    assert.match(denied.body.error, /not authorized/);

    const corrected = await post(
      base,
      "/v1/intakes/" + unresolved.body.intake_id + "/workspace-decision",
      {
        decision: "correct",
        workspace: "life",
        decided_by: "nainai",
        reason: "creator owns the formal classification",
      },
    );
    assert.equal(corrected.status, 200, JSON.stringify(corrected.body));

    const systemIntakeId = "intake_system_classified_read_model";
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO intake_events VALUES (?, ?, ?, 'accepted', ?)").run(
      systemIntakeId,
      "agenthub",
      JSON.stringify({ message: "system classified project intake" }),
      stamp,
    );
    recordWorkspaceAssignment(db, systemIntakeId, {
      workspace: "projects",
      status: "classified",
      confidence: "high",
      candidates: ["projects"],
      reason_codes: ["test_fixture"],
      source: "agenthub",
    });

    const eventCountBeforeReads = db.prepare("SELECT COUNT(*) count FROM events").get().count;

    const index = await request(base, "/v1/workspaces");
    assert.equal(index.status, 200);
    assert.equal(index.body.model, "workspace_index");
    assert.equal(index.body.source_of_truth, "sqlite");
    assert.deepEqual(index.body.items.map((item) => item.workspace), VISIBLE_WORKSPACES);
    assert.ok(!index.body.items.some((item) => item.workspace === "inbox"));

    const internalInbox = await request(base, "/v1/workspaces/inbox");
    assert.equal(internalInbox.status, 404);

    const models = new Map();
    for (const workspace of VISIBLE_WORKSPACES) {
      const result = await request(base, "/v1/workspaces/" + workspace);
      assert.equal(
        result.status,
        200,
        "workspace " + workspace + ": " + JSON.stringify(result.body),
      );
      assert.equal(result.body.model, "workspace");
      assert.equal(result.body.workspace, workspace);
      assert.equal(result.body.source_of_truth, "sqlite");
      models.set(workspace, result.body);
    }

    const projects = models.get("projects");
    assert.equal(projects.protected_project_count, 1);
    assert.ok(!JSON.stringify(projects).includes("protected-secret"));
    assert.ok(!JSON.stringify(projects).includes("Should not leak"));
    const classified = projects.recent_intakes.find((item) => item.intake_id === systemIntakeId);
    assert.equal(classified.assignment.decision_state, "system_classified");

    const today = models.get("today");
    assert.equal(today.protected_project_count, 1);
    assert.ok(!JSON.stringify(today).includes("protected-secret"));
    assert.ok(!JSON.stringify(today).includes("Should not leak"));

    const agentHubToday = await request(base, "/v1/channels/agenthub/today");
    assert.equal(agentHubToday.status, 200);
    assert.equal(agentHubToday.body.protected_project_count, 1);
    assert.ok(!JSON.stringify(agentHubToday.body).includes("protected-secret"));
    assert.ok(!JSON.stringify(agentHubToday.body).includes("Should not leak"));

    const life = models.get("life");
    const creatorConfirmed = life.recent_intakes.find(
      (item) => item.intake_id === unresolved.body.intake_id,
    );
    assert.equal(creatorConfirmed.assignment.decision_state, "creator_confirmed");
    assert.equal(creatorConfirmed.assignment.decided_by, "local_creator");

    const creatorModel = await request(base, "/v1/creator-model");
    assert.equal(creatorModel.status, 200);
    assert.equal(creatorModel.body.model, "creator_model");
    assert.equal(creatorModel.body.source_of_truth, "sqlite");

    const judgments = await request(base, "/v1/judgments");
    assert.equal(judgments.status, 200);
    assert.equal(judgments.body.model, "judgments");
    assert.equal(judgments.body.source_of_truth, "sqlite");

    const eventCountAfterReads = db.prepare("SELECT COUNT(*) count FROM events").get().count;
    assert.equal(eventCountAfterReads, eventCountBeforeReads);
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
