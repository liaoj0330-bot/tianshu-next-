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
  decideExperienceCounterexample,
  decideJudgment,
  decideOutcome,
  evaluateExperienceUsage,
  getExperience,
  proposeExperienceVersion,
  recordExperienceCounterexample,
  recordOutcome,
  rollbackExperience,
  withdrawExperienceCandidate,
} from "../src/intelligence/judgment-loop.mjs";

function fixture(name) {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  return { root, db: openStore(join(root, "state.sqlite")) };
}

function judgmentInput(question = "How should TianShu handle a formal decision?") {
  return {
    subject_type: "system_design",
    subject_id: "creator-authority",
    workspace: "knowledge",
    question,
    facts: [{ claim: "Nainai owns the goal" }],
    inferences: [{ claim: "Channels cannot confirm for Nainai" }],
    evidence: [{ ref: "authority baseline" }],
    uncertainties: [],
    alternatives: [],
    recommendation: { action: "Require explicit Nainai confirmation" },
    confidence: "high",
  };
}

function activeExperience(db) {
  const judgment = createJudgment(db, judgmentInput());
  decideJudgment(db, judgment.judgment_id, {
    decision: "accept",
    reason: "correct authority boundary",
    decided_by: "nainai",
  });
  const outcome = recordOutcome(db, judgment.judgment_id, {
    summary: "Unauthorized confirmation was prevented",
    result: { unauthorized_confirmation_count: 0 },
    evidence: [{ check: "authority", passed: true }],
    recorded_by: "executor",
  });
  decideOutcome(db, outcome.outcome_id, {
    decision: "confirm",
    reason: "evidence matches the result",
    decided_by: "nainai",
  });
  const experience = createExperienceCandidate(db, outcome.outcome_id, {
    title: "Creator owns formal decisions",
    rule: { when: "a formal decision is requested", then: "ask Nainai" },
    applicability: { surfaces: ["agenthub", "web"] },
  });
  return {
    outcomeId: outcome.outcome_id,
    experience: decideExperience(db, experience.experience_id, {
      decision: "activate",
      reason: "bounded reusable rule",
      decided_by: "nainai",
    }),
  };
}

test("experience revisions preserve the active version until accepted and support explicit rollback", () => {
  const f = fixture("tianshu-experience-version");
  try {
    const { outcomeId, experience: initial } = activeExperience(f.db);
    const v1 = initial.current_version_id;

    let revised = proposeExperienceVersion(f.db, initial.experience_id, {
      rule: { when: "a formal decision is requested", then: "show consequences and ask Nainai" },
      applicability: { surfaces: ["agenthub", "web", "obsidian"] },
      source_outcome_ids: [outcomeId],
      reason: "make the confirmation consequence visible",
    });
    const rejectedV2 = revised.versions.at(-1).version_id;
    revised = decideExperience(f.db, revised.experience_id, {
      decision: "reject",
      reason: "scope is too broad",
      decided_by: "nainai",
    });
    assert.equal(revised.status, "active");
    assert.equal(revised.current_version_id, v1);
    assert.equal(revised.versions.find((item) => item.version_id === rejectedV2).status, "rejected");

    revised = proposeExperienceVersion(f.db, revised.experience_id, {
      rule: { when: "AgentHub requests a formal decision", then: "show consequences and ask Nainai" },
      applicability: { surfaces: ["agenthub"] },
      source_outcome_ids: [outcomeId],
      reason: "narrow the revised scope",
    });
    const v3 = revised.versions.at(-1).version_id;
    revised = decideExperience(f.db, revised.experience_id, {
      decision: "activate",
      reason: "scope is now explicit",
      decided_by: "nainai",
    });
    assert.equal(revised.current_version_id, v3);
    assert.equal(revised.versions.find((item) => item.version_id === v1).status, "superseded");

    assert.throws(
      () => rollbackExperience(f.db, revised.experience_id, v1, { decided_by: "agenthub" }),
      /not authorized for experience\.promote/,
    );
    const rolledBack = rollbackExperience(f.db, revised.experience_id, v1, {
      reason: "the narrower rule missed another governed surface",
      evidence: [{ observation: "web confirmation also needs the boundary" }],
      decided_by: "nainai",
    });
    assert.equal(rolledBack.current_version_id, v1);
    assert.equal(rolledBack.versions.find((item) => item.version_id === v3).status, "superseded");
    assert.equal(rolledBack.lifecycle.at(-1).event_type, "rolled_back");
    assert.equal(rolledBack.lifecycle.at(-1).from_version_id, v3);
  } finally {
    f.db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("confirmed counterexamples stop future citation until a creator-approved revision addresses them", () => {
  const f = fixture("tianshu-experience-counterexample");
  try {
    const { outcomeId, experience: initial } = activeExperience(f.db);
    const activeVersionId = initial.current_version_id;

    const cited = createJudgment(f.db, {
      ...judgmentInput("Should every low-risk read-only view require another confirmation?"),
      experience_citations: [{
        experience_version_id: activeVersionId,
        influence: { effect: "require explicit creator decision" },
      }],
    });
    decideJudgment(f.db, cited.judgment_id, {
      decision: "correct",
      correction: { recommendation: { action: "Do not require confirmation for read-only display" } },
      reason: "the old experience was applied outside its useful boundary",
      decided_by: "nainai",
    });
    const usageId = f.db.prepare("SELECT usage_id FROM experience_usages WHERE judgment_id=?")
      .get(cited.judgment_id).usage_id;
    assert.throws(
      () => evaluateExperienceUsage(f.db, usageId, {
        assessment: "harmful",
        impact: { effect: "added unnecessary friction" },
        evaluated_by: "agenthub",
      }),
      /not authorized for formal_state\.confirm/,
    );
    let experience = evaluateExperienceUsage(f.db, usageId, {
      assessment: "harmful",
      impact: { effect: "added unnecessary friction", correction_required: true },
      evidence: [{ judgment_id: cited.judgment_id }],
      evaluated_by: "nainai",
    });
    assert.equal(experience.usages[0].evaluation.assessment, "harmful");

    const counterexample = recordExperienceCounterexample(f.db, experience.experience_id, {
      observation: {
        context: "read-only display",
        contradiction: "confirmation creates friction without changing formal state",
      },
      evidence: [{ judgment_id: cited.judgment_id }],
    });
    assert.equal(counterexample.status, "candidate");
    assert.equal(getExperience(f.db, experience.experience_id).status, "active");
    assert.throws(
      () => decideExperienceCounterexample(f.db, counterexample.counterexample_id, {
        decision: "confirm",
        decided_by: "agenthub",
      }),
      /not authorized for experience\.promote/,
    );
    experience = decideExperienceCounterexample(f.db, counterexample.counterexample_id, {
      decision: "confirm",
      reason: "this is a valid boundary counterexample",
      decided_by: "nainai",
    });
    assert.equal(experience.status, "retired");
    assert.equal(experience.current_version_id, null);
    assert.throws(
      () => createJudgment(f.db, {
        ...judgmentInput("Can the retired rule still influence a judgment?"),
        experience_citations: [{
          experience_version_id: activeVersionId,
          influence: { effect: "should be blocked" },
        }],
      }),
      /is not active/,
    );

    experience = proposeExperienceVersion(f.db, experience.experience_id, {
      rule: {
        when: "an operation changes formal state",
        then: "show consequences and ask Nainai",
      },
      applicability: { mutations_only: true },
      source_outcome_ids: [outcomeId],
      reason: "exclude read-only presentation",
    });
    const candidate = experience.versions.at(-1);
    assert.equal(candidate.status, "candidate");
    assert.equal(candidate.counterexamples[0].counterexample_id, counterexample.counterexample_id);
    experience = decideExperience(f.db, experience.experience_id, {
      decision: "activate",
      reason: "the revised scope addresses the confirmed counterexample",
      decided_by: "nainai",
    });
    assert.equal(experience.status, "active");
    assert.equal(experience.current_version_id, candidate.version_id);
  } finally {
    f.db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a creator can withdraw an undecided revision without disturbing the active experience", () => {
  const f = fixture("tianshu-experience-withdraw");
  try {
    const { outcomeId, experience: initial } = activeExperience(f.db);
    const v1 = initial.current_version_id;
    const revised = proposeExperienceVersion(f.db, initial.experience_id, {
      rule: { when: "anything happens", then: "always interrupt Nainai" },
      applicability: { scope: "too broad" },
      source_outcome_ids: [outcomeId],
    });
    const candidateId = revised.versions.at(-1).version_id;
    const withdrawn = withdrawExperienceCandidate(f.db, revised.experience_id, {
      reason: "proposal was overgeneralized",
      decided_by: "nainai",
    });
    assert.equal(withdrawn.status, "active");
    assert.equal(withdrawn.current_version_id, v1);
    assert.equal(withdrawn.versions.find((item) => item.version_id === candidateId).status, "rejected");
    assert.equal(withdrawn.lifecycle.at(-1).event_type, "withdrawn");
  } finally {
    f.db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
