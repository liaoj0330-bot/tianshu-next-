import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import { getWorkspaceAssignmentForIntake } from "../src/product/workspace-assignment.mjs";

async function post(base, path, payload) {
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("real intake persists workspace classification and creator correction across restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-workspace-"));
  const path = join(root, "state.sqlite");
  let db = openStore(path);
  let gateway = createGateway({ db });
  try {
    let address = await gateway.listen();
    let base = `http://${address.address}:${address.port}`;

    const projectResponse = await post(base, "/v1/intake", {
      source: "agenthub",
      message: "今天高校项目进入专家确认阶段",
    });
    const project = await projectResponse.json();
    assert.equal(projectResponse.status, 202);
    assert.equal(project.workspace_assignment.effective_workspace, "projects");
    assert.equal(project.workspace_assignment.status, "classified");

    const mixedResponse = await post(base, "/v1/intake", {
      source: "agenthub",
      message: "项目今晚要交付，但我需要陪家人去医院",
    });
    const mixed = await mixedResponse.json();
    assert.equal(mixed.workspace_assignment.effective_workspace, "inbox");
    assert.equal(mixed.workspace_assignment.status, "needs_creator_confirmation");
    assert.equal(mixed.next, "confirm_workspace");

    const confirmations = await fetch(base + "/v1/confirmations").then((response) => response.json());
    assert.ok(confirmations.items.some((item) => item.type === "workspace" && item.result.intake_id === mixed.intake_id));

    const deniedResponse = await post(base, `/v1/intakes/${mixed.intake_id}/workspace-decision`, {
      decision: "correct",
      workspace: "life",
      decided_by: "agenthub",
      reason: "channel must not decide",
    });
    assert.equal(deniedResponse.status, 400);
    assert.match((await deniedResponse.json()).error, /not authorized/);

    const correctedResponse = await post(base, `/v1/intakes/${mixed.intake_id}/workspace-decision`, {
      decision: "correct",
      workspace: "life",
      decided_by: "nainai",
      reason: "这次的真实约束是个人生活安排",
    });
    const corrected = await correctedResponse.json();
    assert.equal(correctedResponse.status, 200);
    assert.equal(corrected.assignment.effective_workspace, "life");
    assert.equal(corrected.assignment.status, "corrected");
    assert.equal(corrected.assignment.revisions.length, 2);
    assert.equal(corrected.assignment.revisions[1].decided_by, "local_creator");

    await gateway.close();
    db.close();
    gateway = null;
    db = openStore(path);
    const restored = getWorkspaceAssignmentForIntake(db, mixed.intake_id);
    assert.equal(restored.effective_workspace, "life");
    assert.equal(restored.status, "corrected");
    assert.equal(restored.revisions.length, 2);
  } finally {
    await gateway?.close();
    db?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("unresolved intake remains visible and requests creator classification", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-workspace-unresolved-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  try {
    const address = await gateway.listen();
    const base = `http://${address.address}:${address.port}`;
    const response = await post(base, "/v1/intake", {
      source: "agenthub",
      message: "我刚刚想到了一件事",
    });
    const result = await response.json();
    assert.equal(response.status, 202);
    assert.equal(result.workspace_assignment.status, "unresolved");
    assert.equal(result.workspace_assignment.effective_workspace, "inbox");
    assert.equal(result.next, "confirm_workspace");

    const confirmations = await fetch(base + "/v1/confirmations").then((item) => item.json());
    assert.ok(confirmations.items.some((item) => (
      item.type === "workspace" && item.result.intake_id === result.intake_id
    )));
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
