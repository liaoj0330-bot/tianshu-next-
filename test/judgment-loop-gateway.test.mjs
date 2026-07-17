import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";

async function post(base, path, payload) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

test("gateway exposes the governed judgment to reusable-experience loop", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-judgment-gateway-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  try {
    const address = await gateway.listen();
    const base = `http://${address.address}:${address.port}`;
    const created = await post(base, "/v1/judgments", {
      subject_type: "system_design",
      subject_id: "agenthub-boundary",
      workspace: "knowledge",
      question: "Why does TianShu need AgentHub?",
      facts: [{ claim: "Nainai needs one interaction entrance" }],
      inferences: [{ claim: "AgentHub reduces interaction fragmentation" }],
      evidence: [{ ref: "authority baseline" }],
      uncertainties: [],
      alternatives: [],
      recommendation: { action: "Use AgentHub as the single interaction shell" },
      confidence: "high",
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.next, "await_creator_feedback");
    const judgmentId = created.body.judgment.judgment_id;

    const denied = await post(base, `/v1/judgments/${judgmentId}/feedback`, {
      decision: "accept", decided_by: "agenthub",
    });
    assert.equal(denied.response.status, 400);
    assert.match(denied.body.error, /not authorized/);
    const accepted = await post(base, `/v1/judgments/${judgmentId}/feedback`, {
      decision: "accept", reason: "matches my workflow", decided_by: "nainai",
    });
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.body.judgment.status, "accepted");

    const reported = await post(base, `/v1/judgments/${judgmentId}/outcomes`, {
      summary: "AgentHub denial contract passed",
      result: { unauthorized_decision_blocked: true },
      evidence: [{ test: "gateway", passed: true }],
      recorded_by: "executor",
    });
    assert.equal(reported.response.status, 201);
    const outcomeId = reported.body.outcome.outcome_id;
    const confirmed = await post(base, `/v1/outcomes/${outcomeId}/decision`, {
      decision: "confirm", reason: "verified evidence", decided_by: "nainai",
    });
    assert.equal(confirmed.body.outcome.status, "confirmed");

    const candidate = await post(base, `/v1/outcomes/${outcomeId}/experience-candidates`, {
      title: "AgentHub authority boundary",
      rule: { channel: "submit and display", authority: "none" },
      applicability: { surface: "agenthub" },
    });
    assert.equal(candidate.response.status, 201);
    const experienceId = candidate.body.experience.experience_id;
    const activated = await post(base, `/v1/experiences/${experienceId}/decision`, {
      decision: "activate", reason: "confirmed reusable rule", decided_by: "nainai",
    });
    assert.equal(activated.response.status, 200);
    assert.equal(activated.body.experience.status, "active");
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
