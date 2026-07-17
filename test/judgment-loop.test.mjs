import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../src/core/store.mjs";
import {
  createExperienceCandidate,
  createJudgment,
  decideExperience,
  decideJudgment,
  decideOutcome,
  getJudgment,
  recordOutcome,
} from "../src/intelligence/judgment-loop.mjs";

function fixture(name) {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  const path = join(root, "state.sqlite");
  return { root, path, db: openStore(path) };
}

function proposedJudgment(overrides = {}) {
  return {
    subject_type: "project",
    subject_id: "tianshu-next",
    workspace: "projects",
    question: "AgentHub should play which role in TianShu?",
    facts: [{ claim: "SQLite is the machine-state authority", source: "AGENTS.md" }],
    inferences: [{ claim: "AgentHub should remain an interaction channel" }],
    evidence: [{ kind: "repository", ref: "src/governance/authority.mjs" }],
    uncertainties: [{ question: "Which AgentHub card capabilities are available?" }],
    alternatives: [{ option: "Use Obsidian as the state store", rejected_because: "violates authority boundary" }],
    recommendation: { action: "Use AgentHub for intake, confirmation cards, and progress" },
    confidence: "high",
    ...overrides,
  };
}

test("judgment feedback and confirmed outcome survive restart without rewriting proposals", () => {
  const f = fixture("tianshu-judgment");
  let db = f.db;
  try {
    const judgment = createJudgment(db, proposedJudgment());
    assert.equal(judgment.status, "awaiting_creator_feedback");
    assert.throws(
      () => decideJudgment(db, judgment.judgment_id, { decision: "accept", decided_by: "agenthub" }),
      /not authorized for formal_state\.confirm/,
    );
    const corrected = decideJudgment(db, judgment.judgment_id, {
      decision: "correct",
      correction: { recommendation: { action: "Use AgentHub as the unified interaction shell, never as the control plane" } },
      reason: "Nainai keeps final judgment authority",
      decided_by: "nainai",
    });
    assert.equal(corrected.status, "corrected");
    assert.match(corrected.effective.recommendation.action, /unified interaction shell/);
    assert.equal(corrected.recommendation.action, "Use AgentHub for intake, confirmation cards, and progress");

    assert.throws(
      () => recordOutcome(db, judgment.judgment_id, { summary: "done", result: {}, recorded_by: "independent_verifier" }),
      /not authorized for execution\.report/,
    );
    const outcome = recordOutcome(db, judgment.judgment_id, {
      summary: "AgentHub boundary implemented",
      result: { gateway_contract: "intake-display-confirmation" },
      evidence: [{ test: "gateway contract", passed: true }],
      recorded_by: "executor",
    });
    assert.equal(outcome.status, "candidate");
    assert.throws(
      () => decideOutcome(db, outcome.outcome_id, { decision: "confirm", decided_by: "executor" }),
      /not authorized for formal_state\.confirm/,
    );
    const confirmed = decideOutcome(db, outcome.outcome_id, {
      decision: "confirm", reason: "matches the intended boundary", decided_by: "nainai",
    });
    assert.equal(confirmed.status, "confirmed");

    db.close();
    db = openStore(f.path);
    const restored = getJudgment(db, judgment.judgment_id);
    assert.equal(restored.status, "corrected");
    assert.match(restored.effective.recommendation.action, /unified interaction shell/);
    assert.equal(db.prepare("SELECT status FROM outcomes WHERE outcome_id=?").get(outcome.outcome_id).status, "confirmed");
  } finally {
    db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a later judgment can cite only experience activated by Nainai", () => {
  const f = fixture("tianshu-experience");
  const { db } = f;
  try {
    const first = createJudgment(db, proposedJudgment());
    decideJudgment(db, first.judgment_id, { decision: "accept", reason: "correct boundary", decided_by: "nainai" });
    const outcome = recordOutcome(db, first.judgment_id, {
      summary: "The boundary prevented channel overreach",
      result: { prevented_unauthorized_confirmation: true },
      evidence: [{ test: "agenthub confirmation denial", passed: true }],
      recorded_by: "executor",
    });
    decideOutcome(db, outcome.outcome_id, { decision: "confirm", reason: "test evidence verified", decided_by: "nainai" });
    const experience = createExperienceCandidate(db, outcome.outcome_id, {
      title: "Interaction channels do not own decisions",
      rule: { when: "an interaction surface submits a formal decision", then: "require Nainai confirmation" },
      applicability: { channels: ["agenthub", "obsidian"] },
    });
    const versionId = experience.versions[0].version_id;
    assert.throws(
      () => createJudgment(db, proposedJudgment({
        question: "Should a new channel auto-confirm?",
        experience_citations: [{ experience_version_id: versionId, influence: { effect: "block auto-confirm" } }],
      })),
      /is not active/,
    );
    assert.throws(
      () => decideExperience(db, experience.experience_id, { decision: "activate", decided_by: "agenthub" }),
      /not authorized for experience\.promote/,
    );
    decideExperience(db, experience.experience_id, { decision: "activate", reason: "reusable and bounded", decided_by: "nainai" });
    const second = createJudgment(db, proposedJudgment({
      question: "Should a new channel auto-confirm?",
      recommendation: { action: "Require explicit Nainai confirmation" },
      experience_citations: [{ experience_version_id: versionId, influence: { effect: "block auto-confirm" } }],
    }));
    assert.equal(second.experience_citations.length, 1);
    assert.equal(second.experience_citations[0].experience_version_id, versionId);
    assert.deepEqual(second.experience_citations[0].influence, { effect: "block auto-confirm" });
    assert.equal(db.prepare("SELECT COUNT(*) count FROM experience_usages WHERE judgment_id=?").get(second.judgment_id).count, 1);
  } finally {
    db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
