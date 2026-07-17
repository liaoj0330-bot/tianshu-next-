import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import {
  createExperienceCandidate,
  createJudgment,
  decideExperience,
  decideJudgment,
  decideOutcome,
  recordOutcome,
} from "../src/intelligence/judgment-loop.mjs";

async function request(base, path, init = {}) {
  const response = await fetch(base + path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  return { status: response.status, body: await response.json() };
}

const post = (base, path, body) => request(base, path, {
  method: "POST",
  body: JSON.stringify(body),
});

function judgmentInput(question) {
  return {
    subject_type: "system_design",
    subject_id: "experience-gateway",
    workspace: "evolution",
    question,
    facts: [{ claim: "formal state requires creator confirmation" }],
    inferences: [{ claim: "experience scope must remain bounded" }],
    evidence: [{ ref: "authority baseline" }],
    uncertainties: [],
    alternatives: [],
    recommendation: { action: "Ask Nainai before formal state changes" },
    confidence: "high",
  };
}

function seedActiveExperience(db) {
  const judgment = createJudgment(db, judgmentInput("Who confirms formal state?"));
  decideJudgment(db, judgment.judgment_id, {
    decision: "accept",
    reason: "Nainai is the authority",
    decided_by: "nainai",
  });
  const outcome = recordOutcome(db, judgment.judgment_id, {
    summary: "Channel overreach was blocked",
    result: { blocked: true },
    evidence: [{ check: "authority", passed: true }],
    recorded_by: "executor",
  });
  decideOutcome(db, outcome.outcome_id, {
    decision: "confirm",
    reason: "verified",
    decided_by: "nainai",
  });
  const candidate = createExperienceCandidate(db, outcome.outcome_id, {
    title: "Creator confirmation boundary",
    rule: { when: "formal state changes", then: "ask Nainai" },
    applicability: { mutations_only: true },
  });
  return {
    outcomeId: outcome.outcome_id,
    experience: decideExperience(db, candidate.experience_id, {
      decision: "activate",
      reason: "reusable",
      decided_by: "nainai",
    }),
  };
}

test("Today and Evolution expose the complete creator-governed experience lifecycle", async () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-experience-gateway-"));
  const db = openStore(join(root, "state.sqlite"));
  const gateway = createGateway({ db });
  try {
    const address = await gateway.listen();
    const base = `http://${address.address}:${address.port}`;

    const ignoredJudgment = createJudgment(db, judgmentInput("Should this low-value observation remain in Today?"));
    let today = await request(base, "/v1/today");
    assert.ok(today.body.confirmations.some((item) => (
      item.type === "judgment" && item.confirmation_id === ignoredJudgment.judgment_id
    )));
    const ignored = await post(base, `/v1/judgments/${ignoredJudgment.judgment_id}/feedback`, {
      decision: "ignore",
      reason: "not useful enough to revisit",
      decided_by: "nainai",
    });
    assert.equal(ignored.status, 200);
    assert.equal(ignored.body.judgment.status, "ignored");
    const ignoredList = await request(base, "/v1/judgments?status=ignored");
    assert.equal(ignoredList.body.items[0].status, "ignored");

    const { outcomeId, experience: initial } = seedActiveExperience(db);
    const proposed = await post(base, `/v1/experiences/${initial.experience_id}/versions`, {
      rule: { when: "a governed mutation is proposed", then: "show consequences and ask Nainai" },
      applicability: { mutations_only: true, surfaces: ["agenthub", "web"] },
      source_outcome_ids: [outcomeId],
      reason: "make consequences explicit",
    });
    assert.equal(proposed.status, 201);
    const candidateVersion = proposed.body.experience.versions.at(-1);
    today = await request(base, "/v1/today");
    assert.ok(today.body.confirmations.some((item) => (
      item.type === "experience_version" && item.confirmation_id === candidateVersion.version_id
    )));
    const activated = await post(base, `/v1/experiences/${initial.experience_id}/decision`, {
      decision: "activate",
      reason: "the revised scope remains bounded",
      decided_by: "nainai",
    });
    assert.equal(activated.body.experience.current_version_id, candidateVersion.version_id);

    const counterexample = await post(base, `/v1/experiences/${initial.experience_id}/counterexamples`, {
      observation: {
        context: "read-only explanation",
        contradiction: "read-only presentation must not ask for execution confirmation",
      },
      evidence: [{ scenario: "Today read model" }],
    });
    assert.equal(counterexample.status, 201);
    today = await request(base, "/v1/today");
    assert.ok(today.body.confirmations.some((item) => (
      item.type === "experience_counterexample"
      && item.confirmation_id === counterexample.body.counterexample.counterexample_id
    )));
    const confirmedCounterexample = await post(
      base,
      `/v1/experience-counterexamples/${counterexample.body.counterexample.counterexample_id}/decision`,
      { decision: "confirm", reason: "valid scope boundary", decided_by: "nainai" },
    );
    assert.equal(confirmedCounterexample.body.experience.status, "retired");

    const revised = await post(base, `/v1/experiences/${initial.experience_id}/versions`, {
      rule: { when: "an operation will mutate formal state", then: "show consequences and ask Nainai" },
      applicability: { mutations_only: true, excludes: ["read_only_display"] },
      source_outcome_ids: [outcomeId],
      reason: "address the confirmed counterexample",
    });
    const revisedCandidate = revised.body.experience.versions.at(-1);
    assert.equal(revisedCandidate.counterexamples[0].counterexample_id, counterexample.body.counterexample.counterexample_id);
    await post(base, `/v1/experiences/${initial.experience_id}/decision`, {
      decision: "activate",
      reason: "counterexample is now represented in scope",
      decided_by: "nainai",
    });

    const later = createJudgment(db, {
      ...judgmentInput("Should a state-changing operation require confirmation?"),
      experience_citations: [{
        experience_version_id: revisedCandidate.version_id,
        influence: { effect: "require confirmation" },
      }],
    });
    decideJudgment(db, later.judgment_id, {
      decision: "accept",
      reason: "the revised experience was useful",
      decided_by: "nainai",
    });
    const usageId = db.prepare("SELECT usage_id FROM experience_usages WHERE judgment_id=?")
      .get(later.judgment_id).usage_id;
    today = await request(base, "/v1/today");
    assert.ok(today.body.confirmations.some((item) => (
      item.type === "experience_usage" && item.confirmation_id === usageId
    )));
    const evaluated = await post(base, `/v1/experience-usages/${usageId}/evaluation`, {
      assessment: "helpful",
      impact: { effect: "avoided an authorization ambiguity" },
      evidence: [{ judgment_id: later.judgment_id }],
      evaluated_by: "nainai",
    });
    assert.equal(evaluated.status, 201);
    today = await request(base, "/v1/today");
    assert.equal(today.body.confirmations.some((item) => item.confirmation_id === usageId), false);

    const evolution = await request(base, "/v1/workspaces/evolution");
    const projected = evolution.body.experiences.find((item) => item.experience_id === initial.experience_id);
    assert.equal(projected.usage_summary.helpful, 1);
    assert.ok(projected.lifecycle.some((item) => item.event_type === "counterexample_confirmed"));
    assert.equal(projected.counterexamples[0].status, "confirmed");
  } finally {
    await gateway.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
