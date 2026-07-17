import { appendEvent, canonicalJson, newId, now } from "../core/store.mjs";
import { assertAuthority } from "../governance/authority.mjs";
import { WORKSPACES } from "../product/workspace-classifier.mjs";

const WORKSPACE_SET = new Set(WORKSPACES);
const parse = (value, fallback = null) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function array(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function nonempty(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function decorateJudgment(row) {
  if (!row) return null;
  return {
    ...row,
    facts: parse(row.facts_json, []),
    inferences: parse(row.inferences_json, []),
    evidence: parse(row.evidence_json, []),
    uncertainties: parse(row.uncertainties_json, []),
    alternatives: parse(row.alternatives_json, []),
    recommendation: parse(row.recommendation_json, {}),
  };
}

function decorateOutcome(row) {
  if (!row) return null;
  return {
    ...row,
    result: parse(row.result_json, {}),
    evidence: parse(row.evidence_json, []),
  };
}

function decorateVersion(row) {
  if (!row) return null;
  return {
    ...row,
    rule: parse(row.rule_json, {}),
    source_outcomes: parse(row.source_outcomes_json, []),
    counterexamples: parse(row.counterexamples_json, []),
    applicability: parse(row.applicability_json, {}),
  };
}

function recordExperienceLifecycle(db, {
  experience_id,
  version_id = null,
  event_type,
  from_version_id = null,
  reason = "",
  evidence = [],
  actor,
  created_at = now(),
}) {
  db.prepare(`
    INSERT INTO experience_lifecycle_events(
      lifecycle_event_id,experience_id,version_id,event_type,from_version_id,
      reason,evidence_json,actor,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    newId("experience_event"), experience_id, version_id, event_type,
    from_version_id, reason, canonicalJson(evidence), actor, created_at,
  );
}

export function getJudgment(db, judgmentId) {
  const judgment = decorateJudgment(db.prepare("SELECT * FROM judgments WHERE judgment_id=?").get(judgmentId));
  if (!judgment) return null;
  const feedbackRow = db.prepare("SELECT * FROM judgment_feedback WHERE judgment_id=?").get(judgmentId);
  const feedbackExtension = feedbackRow
    ? db.prepare("SELECT semantic_decision FROM judgment_feedback_extensions WHERE feedback_id=?").get(feedbackRow.feedback_id)
    : null;
  const feedback = feedbackRow ? {
    ...feedbackRow,
    decision: feedbackExtension?.semantic_decision ?? feedbackRow.decision,
    correction: parse(feedbackRow.correction_json, {}),
  } : null;
  const citations = db.prepare(`
    SELECT c.*,e.title,v.version,v.rule_json,v.applicability_json
    FROM judgment_experience_citations c
    JOIN experience_versions v ON v.version_id=c.experience_version_id
    JOIN experiences e ON e.experience_id=v.experience_id
    WHERE c.judgment_id=? ORDER BY c.created_at,c.citation_id
  `).all(judgmentId).map((row) => ({
    ...row,
    influence: parse(row.influence_json, {}),
    rule: parse(row.rule_json, {}),
    applicability: parse(row.applicability_json, {}),
  }));
  const correction = feedback?.decision === "correct" ? feedback.correction : {};
  return {
    ...judgment,
    status: feedback?.decision === "ignore" ? "ignored" : judgment.status,
    feedback,
    experience_citations: citations,
    effective: {
      question: correction.question ?? judgment.question,
      facts: correction.facts ?? judgment.facts,
      inferences: correction.inferences ?? judgment.inferences,
      evidence: correction.evidence ?? judgment.evidence,
      uncertainties: correction.uncertainties ?? judgment.uncertainties,
      alternatives: correction.alternatives ?? judgment.alternatives,
      recommendation: correction.recommendation ?? judgment.recommendation,
      confidence: correction.confidence ?? judgment.confidence,
    },
  };
}

export function createJudgment(db, {
  intake_id = null,
  subject_type = "topic",
  subject_id,
  workspace,
  question,
  facts = [],
  inferences = [],
  evidence = [],
  uncertainties = [],
  alternatives = [],
  recommendation,
  confidence = "medium",
  created_by = "tianshu_orchestrator",
  experience_citations = [],
} = {}) {
  const actor = assertAuthority(db, created_by, "machine_state.transition");
  if (!WORKSPACE_SET.has(workspace)) throw new Error("judgment requires a valid workspace");
  if (!["high", "medium", "low"].includes(confidence)) throw new Error("invalid judgment confidence");
  array(facts, "facts"); array(inferences, "inferences"); array(evidence, "evidence");
  array(uncertainties, "uncertainties"); array(alternatives, "alternatives");
  object(recommendation, "recommendation");
  const judgmentId = newId("judgment"), stamp = now();
  const citations = experience_citations.map((citation) => {
    const versionId = nonempty(citation.experience_version_id, "experience_version_id");
    const version = db.prepare(`
      SELECT v.*,e.status experience_status FROM experience_versions v
      JOIN experiences e ON e.experience_id=v.experience_id
      WHERE v.version_id=?
    `).get(versionId);
    if (!version || version.status !== "active" || version.experience_status !== "active") {
      throw new Error(`experience version ${versionId} is not active`);
    }
    return { versionId, influence: object(citation.influence ?? {}, "citation influence") };
  });
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO judgments(
        judgment_id,intake_id,subject_type,subject_id,workspace,question,facts_json,
        inferences_json,evidence_json,uncertainties_json,alternatives_json,
        recommendation_json,confidence,status,created_by,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'awaiting_creator_feedback',?,?,?)
    `).run(
      judgmentId, intake_id, nonempty(subject_type, "subject_type"), nonempty(subject_id, "subject_id"),
      workspace, nonempty(question, "question"), canonicalJson(facts), canonicalJson(inferences),
      canonicalJson(evidence), canonicalJson(uncertainties), canonicalJson(alternatives),
      canonicalJson(recommendation), confidence, actor, stamp, stamp,
    );
    for (const citation of citations) {
      const influenceJson = canonicalJson(citation.influence);
      db.prepare(`INSERT INTO judgment_experience_citations VALUES (?,?,?,?,?)`)
        .run(newId("citation"), judgmentId, citation.versionId, influenceJson, stamp);
      db.prepare(`INSERT INTO experience_usages VALUES (?,?,?,?,NULL,?,NULL)`)
        .run(newId("experience_usage"), citation.versionId, judgmentId, influenceJson, stamp);
    }
    appendEvent(db, "judgment", judgmentId, "judgment.created", {
      subject_type, subject_id, workspace, created_by: actor,
      experience_version_ids: citations.map((item) => item.versionId),
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getJudgment(db, judgmentId);
}

export function decideJudgment(db, judgmentId, {
  decision,
  correction = {},
  reason = "",
  decided_by = "creator",
} = {}) {
  if (!["accept", "correct", "reject", "defer", "ignore"].includes(decision)) throw new Error("invalid judgment decision");
  const actor = assertAuthority(db, decided_by, "formal_state.confirm");
  const judgment = getJudgment(db, judgmentId);
  if (!judgment) throw new Error("judgment not found");
  if (judgment.status !== "awaiting_creator_feedback") throw new Error("judgment already decided");
  if (decision === "correct" && (!correction || typeof correction !== "object" || !Object.keys(correction).length)) {
    throw new Error("judgment correction is required");
  }
  if (["correct", "reject", "defer", "ignore"].includes(decision) && !String(reason).trim()) {
    throw new Error(`${decision} judgment feedback requires a reason`);
  }
  const storedDecision = decision === "ignore" ? "defer" : decision;
  const status = { accept: "accepted", correct: "corrected", reject: "rejected", defer: "deferred", ignore: "deferred" }[decision];
  const stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const feedbackId = newId("judgment_feedback");
    db.prepare(`INSERT INTO judgment_feedback VALUES (?,?,?,?,?,?,?)`)
      .run(feedbackId, judgmentId, storedDecision, canonicalJson(correction ?? {}), reason, actor, stamp);
    if (decision === "ignore") {
      db.prepare("INSERT INTO judgment_feedback_extensions VALUES (?,?,?,?)")
        .run(newId("judgment_feedback_extension"), feedbackId, "ignore", stamp);
    }
    db.prepare("UPDATE judgments SET status=?,updated_at=? WHERE judgment_id=?")
      .run(status, stamp, judgmentId);
    appendEvent(db, "judgment", judgmentId, `judgment.${decision === "ignore" ? "ignored" : status}`, { decided_by: actor, reason });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getJudgment(db, judgmentId);
}

export function getOutcome(db, outcomeId) {
  const outcome = decorateOutcome(db.prepare("SELECT * FROM outcomes WHERE outcome_id=?").get(outcomeId));
  if (!outcome) return null;
  const row = db.prepare("SELECT * FROM outcome_decisions WHERE outcome_id=?").get(outcomeId);
  const decision = row ? { ...row, correction: parse(row.correction_json, {}) } : null;
  return {
    ...outcome,
    decision,
    effective: {
      summary: decision?.correction?.summary ?? outcome.summary,
      result: decision?.correction?.result ?? outcome.result,
      evidence: decision?.correction?.evidence ?? outcome.evidence,
    },
  };
}

export function recordOutcome(db, judgmentId, {
  goal_id = null,
  run_id = null,
  summary,
  result,
  evidence = [],
  recorded_by = "executor",
} = {}) {
  const actor = assertAuthority(db, recorded_by, "execution.report");
  const judgment = getJudgment(db, judgmentId);
  if (!judgment) throw new Error("judgment not found");
  if (!["accepted", "corrected"].includes(judgment.status)) throw new Error("outcome requires a creator-confirmed judgment");
  object(result, "result"); array(evidence, "evidence");
  const outcomeId = newId("outcome"), stamp = now();
  db.prepare(`
    INSERT INTO outcomes(
      outcome_id,judgment_id,goal_id,run_id,summary,result_json,evidence_json,
      status,recorded_by,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,'candidate',?,?,?)
  `).run(outcomeId, judgmentId, goal_id, run_id, nonempty(summary, "summary"), canonicalJson(result), canonicalJson(evidence), actor, stamp, stamp);
  appendEvent(db, "outcome", outcomeId, "outcome.reported", { judgment_id: judgmentId, recorded_by: actor });
  return getOutcome(db, outcomeId);
}

export function decideOutcome(db, outcomeId, {
  decision,
  correction = {},
  reason = "",
  decided_by = "creator",
} = {}) {
  if (!["confirm", "correct", "reject"].includes(decision)) throw new Error("invalid outcome decision");
  const actor = assertAuthority(db, decided_by, "formal_state.confirm");
  const outcome = getOutcome(db, outcomeId);
  if (!outcome) throw new Error("outcome not found");
  if (outcome.status !== "candidate") throw new Error("outcome already decided");
  if (decision === "correct" && (!correction || typeof correction !== "object" || !Object.keys(correction).length)) {
    throw new Error("outcome correction is required");
  }
  const status = { confirm: "confirmed", correct: "corrected", reject: "rejected" }[decision], stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO outcome_decisions VALUES (?,?,?,?,?,?,?)`)
      .run(newId("outcome_decision"), outcomeId, decision, canonicalJson(correction ?? {}), reason, actor, stamp);
    db.prepare("UPDATE outcomes SET status=?,updated_at=? WHERE outcome_id=?").run(status, stamp, outcomeId);
    appendEvent(db, "outcome", outcomeId, `outcome.${status}`, { decided_by: actor, reason });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getOutcome(db, outcomeId);
}

export function getExperience(db, experienceId) {
  const experience = db.prepare("SELECT * FROM experiences WHERE experience_id=?").get(experienceId);
  if (!experience) return null;
  return {
    ...experience,
    versions: db.prepare("SELECT * FROM experience_versions WHERE experience_id=? ORDER BY version")
      .all(experienceId).map(decorateVersion),
    counterexamples: db.prepare(`
      SELECT * FROM experience_counterexamples
      WHERE experience_id=? ORDER BY created_at,counterexample_id
    `).all(experienceId).map((row) => ({
      ...row,
      observation: parse(row.observation_json, {}),
      evidence: parse(row.evidence_json, []),
    })),
    lifecycle: db.prepare(`
      SELECT * FROM experience_lifecycle_events
      WHERE experience_id=? ORDER BY created_at,lifecycle_event_id
    `).all(experienceId).map((row) => ({ ...row, evidence: parse(row.evidence_json, []) })),
    usages: db.prepare(`
      SELECT u.*,j.question,j.status judgment_status,
             x.evaluation_id,x.assessment,x.impact_json,x.evidence_json evaluation_evidence_json,
             x.evaluated_by,x.created_at evaluated_at_recorded
      FROM experience_usages u
      JOIN judgments j ON j.judgment_id=u.judgment_id
      LEFT JOIN experience_usage_evaluations x ON x.usage_id=u.usage_id
      WHERE u.experience_version_id IN (
        SELECT version_id FROM experience_versions WHERE experience_id=?
      )
      ORDER BY u.created_at,u.usage_id
    `).all(experienceId).map((row) => ({
      usage_id: row.usage_id,
      experience_version_id: row.experience_version_id,
      judgment_id: row.judgment_id,
      question: row.question,
      judgment_status: row.judgment_status,
      influence: parse(row.influence_json, {}),
      legacy_result: parse(row.result_json, null),
      created_at: row.created_at,
      evaluation: row.evaluation_id ? {
        evaluation_id: row.evaluation_id,
        assessment: row.assessment,
        impact: parse(row.impact_json, {}),
        evidence: parse(row.evaluation_evidence_json, []),
        evaluated_by: row.evaluated_by,
        created_at: row.evaluated_at_recorded,
      } : null,
    })),
  };
}

export function createExperienceCandidate(db, outcomeId, {
  title,
  rule,
  applicability,
  counterexamples = [],
  created_by = "tianshu_orchestrator",
} = {}) {
  const actor = assertAuthority(db, created_by, "machine_state.transition");
  const outcome = getOutcome(db, outcomeId);
  if (!outcome || !["confirmed", "corrected"].includes(outcome.status)) {
    throw new Error("experience candidate requires a creator-confirmed outcome");
  }
  object(rule, "rule"); object(applicability, "applicability"); array(counterexamples, "counterexamples");
  counterexamples.forEach((item) => object(item, "counterexample"));
  const existing = db.prepare("SELECT experience_id FROM experience_versions WHERE source_outcomes_json=?")
    .get(canonicalJson([outcomeId]));
  if (existing) throw new Error("outcome already has an experience candidate");
  const experienceId = newId("experience"), versionId = newId("experience_version"), stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO experiences VALUES (?,?,'candidate',NULL,?,?)")
      .run(experienceId, nonempty(title, "title"), stamp, stamp);
    db.prepare(`
      INSERT INTO experience_versions(
        version_id,experience_id,version,rule_json,source_outcomes_json,
        counterexamples_json,applicability_json,status,created_by,decided_by,created_at,decided_at
      ) VALUES (?,?,1,?,?,?,?,'candidate',?,NULL,?,NULL)
    `).run(versionId, experienceId, canonicalJson(rule), canonicalJson([outcomeId]), canonicalJson(counterexamples), canonicalJson(applicability), actor, stamp);
    recordExperienceLifecycle(db, {
      experience_id: experienceId,
      version_id: versionId,
      event_type: "candidate_created",
      reason: "created from a creator-confirmed outcome",
      evidence: [{ outcome_id: outcomeId }],
      actor,
      created_at: stamp,
    });
    appendEvent(db, "experience", experienceId, "experience.candidate_created", {
      version_id: versionId, source_outcome_id: outcomeId, created_by: actor,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getExperience(db, experienceId);
}

export function decideExperience(db, experienceId, {
  decision,
  reason = "",
  decided_by = "creator",
} = {}) {
  if (!["activate", "reject"].includes(decision)) throw new Error("invalid experience decision");
  const actor = assertAuthority(db, decided_by, "experience.promote");
  const experience = getExperience(db, experienceId);
  if (!experience) throw new Error("experience not found");
  const candidate = [...experience.versions].reverse().find((item) => item.status === "candidate");
  if (!candidate) throw new Error("experience has no candidate version");
  const stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (decision === "activate") {
      const previousVersionId = experience.current_version_id;
      db.prepare("UPDATE experience_versions SET status='superseded' WHERE experience_id=? AND status='active'").run(experienceId);
      db.prepare("UPDATE experience_versions SET status='active',decided_by=?,decided_at=? WHERE version_id=?")
        .run(actor, stamp, candidate.version_id);
      db.prepare("UPDATE experiences SET status='active',current_version_id=?,updated_at=? WHERE experience_id=?")
        .run(candidate.version_id, stamp, experienceId);
      recordExperienceLifecycle(db, {
        experience_id: experienceId,
        version_id: candidate.version_id,
        from_version_id: previousVersionId,
        event_type: "activated",
        reason,
        actor,
        created_at: stamp,
      });
    } else {
      db.prepare("UPDATE experience_versions SET status='rejected',decided_by=?,decided_at=? WHERE version_id=?")
        .run(actor, stamp, candidate.version_id);
      if (experience.current_version_id) {
        db.prepare("UPDATE experiences SET updated_at=? WHERE experience_id=?").run(stamp, experienceId);
      } else {
        db.prepare("UPDATE experiences SET status='rejected',updated_at=? WHERE experience_id=?")
          .run(stamp, experienceId);
      }
      recordExperienceLifecycle(db, {
        experience_id: experienceId,
        version_id: candidate.version_id,
        event_type: "rejected",
        reason,
        actor,
        created_at: stamp,
      });
    }
    const eventName = decision === "activate" ? "experience.activated" : "experience.rejected";
    appendEvent(db, "experience", experienceId, eventName, {
      version_id: candidate.version_id, decided_by: actor, reason,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getExperience(db, experienceId);
}

export function proposeExperienceVersion(db, experienceId, {
  rule,
  applicability,
  source_outcome_ids,
  counterexamples = [],
  reason = "",
  created_by = "tianshu_orchestrator",
} = {}) {
  const actor = assertAuthority(db, created_by, "machine_state.transition");
  const experience = getExperience(db, experienceId);
  if (!experience) throw new Error("experience not found");
  if (!["active", "retired"].includes(experience.status)) {
    throw new Error("only active or retired experience can be revised");
  }
  if (experience.versions.some((item) => item.status === "candidate")) {
    throw new Error("experience already has a candidate version");
  }
  object(rule, "rule"); object(applicability, "applicability");
  array(counterexamples, "counterexamples");
  counterexamples.forEach((item) => object(item, "counterexample"));
  const confirmedCounterexamples = experience.counterexamples
    .filter((item) => item.status === "confirmed")
    .map((item) => ({
      counterexample_id: item.counterexample_id,
      observation: item.observation,
      evidence: item.evidence,
    }));
  const carriedCounterexamples = [...confirmedCounterexamples, ...counterexamples];
  const latest = experience.versions.at(-1);
  const sourceIds = source_outcome_ids ?? latest?.source_outcomes ?? [];
  array(sourceIds, "source_outcome_ids");
  if (!sourceIds.length) throw new Error("experience version requires at least one source outcome");
  for (const outcomeId of sourceIds) {
    const outcome = getOutcome(db, nonempty(outcomeId, "source outcome id"));
    if (!outcome || !["confirmed", "corrected"].includes(outcome.status)) {
      throw new Error(`source outcome ${outcomeId} is not creator-confirmed`);
    }
  }
  const version = Math.max(...experience.versions.map((item) => item.version), 0) + 1;
  const versionId = newId("experience_version"), stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO experience_versions(
        version_id,experience_id,version,rule_json,source_outcomes_json,
        counterexamples_json,applicability_json,status,created_by,decided_by,created_at,decided_at
      ) VALUES (?,?,?,?,?,?,?,'candidate',?,NULL,?,NULL)
    `).run(
      versionId, experienceId, version, canonicalJson(rule), canonicalJson(sourceIds),
      canonicalJson(carriedCounterexamples), canonicalJson(applicability), actor, stamp,
    );
    recordExperienceLifecycle(db, {
      experience_id: experienceId,
      version_id: versionId,
      from_version_id: experience.current_version_id,
      event_type: "version_proposed",
      reason,
      evidence: sourceIds.map((outcome_id) => ({ outcome_id })),
      actor,
      created_at: stamp,
    });
    appendEvent(db, "experience", experienceId, "experience.version_proposed", {
      version_id: versionId, version, source_outcome_ids: sourceIds, created_by: actor,
    });
    db.prepare("UPDATE experiences SET updated_at=? WHERE experience_id=?").run(stamp, experienceId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getExperience(db, experienceId);
}

export function withdrawExperienceCandidate(db, experienceId, {
  reason = "",
  decided_by = "creator",
} = {}) {
  const actor = assertAuthority(db, decided_by, "experience.promote");
  const experience = getExperience(db, experienceId);
  if (!experience) throw new Error("experience not found");
  const candidate = [...experience.versions].reverse().find((item) => item.status === "candidate");
  if (!candidate) throw new Error("experience has no candidate version");
  const stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE experience_versions SET status='rejected',decided_by=?,decided_at=? WHERE version_id=?")
      .run(actor, stamp, candidate.version_id);
    if (!experience.current_version_id) {
      db.prepare("UPDATE experiences SET status='rejected',updated_at=? WHERE experience_id=?")
        .run(stamp, experienceId);
    } else {
      db.prepare("UPDATE experiences SET updated_at=? WHERE experience_id=?").run(stamp, experienceId);
    }
    recordExperienceLifecycle(db, {
      experience_id: experienceId,
      version_id: candidate.version_id,
      event_type: "withdrawn",
      reason,
      actor,
      created_at: stamp,
    });
    appendEvent(db, "experience", experienceId, "experience.candidate_withdrawn", {
      version_id: candidate.version_id, decided_by: actor, reason,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getExperience(db, experienceId);
}

export function retireExperience(db, experienceId, {
  reason = "",
  evidence = [],
  decided_by = "creator",
} = {}) {
  const actor = assertAuthority(db, decided_by, "experience.promote");
  array(evidence, "evidence");
  const experience = getExperience(db, experienceId);
  if (!experience) throw new Error("experience not found");
  if (experience.status !== "active" || !experience.current_version_id) throw new Error("experience is not active");
  const retiredVersionId = experience.current_version_id, stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE experience_versions SET status='superseded' WHERE version_id=?").run(retiredVersionId);
    db.prepare("UPDATE experiences SET status='retired',current_version_id=NULL,updated_at=? WHERE experience_id=?")
      .run(stamp, experienceId);
    recordExperienceLifecycle(db, {
      experience_id: experienceId,
      version_id: retiredVersionId,
      event_type: "retired",
      reason,
      evidence,
      actor,
      created_at: stamp,
    });
    appendEvent(db, "experience", experienceId, "experience.retired", {
      version_id: retiredVersionId, decided_by: actor, reason,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getExperience(db, experienceId);
}

export function rollbackExperience(db, experienceId, targetVersionId, {
  reason = "",
  evidence = [],
  decided_by = "creator",
} = {}) {
  const actor = assertAuthority(db, decided_by, "experience.promote");
  array(evidence, "evidence");
  const experience = getExperience(db, experienceId);
  if (!experience) throw new Error("experience not found");
  if (experience.versions.some((item) => item.status === "candidate")) {
    throw new Error("withdraw or decide the candidate version before rollback");
  }
  const target = experience.versions.find((item) => item.version_id === targetVersionId);
  if (!target || target.status !== "superseded") throw new Error("rollback target must be a superseded version");
  const fromVersionId = experience.current_version_id, stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE experience_versions SET status='superseded' WHERE experience_id=? AND status='active'")
      .run(experienceId);
    db.prepare("UPDATE experience_versions SET status='active',decided_by=?,decided_at=? WHERE version_id=?")
      .run(actor, stamp, targetVersionId);
    db.prepare("UPDATE experiences SET status='active',current_version_id=?,updated_at=? WHERE experience_id=?")
      .run(targetVersionId, stamp, experienceId);
    recordExperienceLifecycle(db, {
      experience_id: experienceId,
      version_id: targetVersionId,
      from_version_id: fromVersionId,
      event_type: "rolled_back",
      reason,
      evidence,
      actor,
      created_at: stamp,
    });
    appendEvent(db, "experience", experienceId, "experience.rolled_back", {
      from_version_id: fromVersionId, target_version_id: targetVersionId,
      decided_by: actor, reason,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getExperience(db, experienceId);
}

export function recordExperienceCounterexample(db, experienceId, {
  affected_version_id,
  observation,
  evidence = [],
  proposed_by = "tianshu_orchestrator",
} = {}) {
  const actor = assertAuthority(db, proposed_by, "machine_state.transition");
  const experience = getExperience(db, experienceId);
  if (!experience) throw new Error("experience not found");
  const versionId = affected_version_id ?? experience.current_version_id;
  const version = experience.versions.find((item) => item.version_id === versionId);
  if (!version) throw new Error("affected experience version not found");
  object(observation, "observation"); array(evidence, "evidence");
  const counterexampleId = newId("experience_counterexample"), stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO experience_counterexamples(
        counterexample_id,experience_id,affected_version_id,observation_json,evidence_json,
        status,proposed_by,decided_by,decision_reason,created_at,decided_at
      ) VALUES (?,?,?,?,?,'candidate',?,NULL,NULL,?,NULL)
    `).run(counterexampleId, experienceId, versionId, canonicalJson(observation), canonicalJson(evidence), actor, stamp);
    appendEvent(db, "experience", experienceId, "experience.counterexample_proposed", {
      counterexample_id: counterexampleId, affected_version_id: versionId, proposed_by: actor,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getExperience(db, experienceId).counterexamples.find((item) => item.counterexample_id === counterexampleId);
}

export function decideExperienceCounterexample(db, counterexampleId, {
  decision,
  reason = "",
  decided_by = "creator",
} = {}) {
  if (!["confirm", "reject"].includes(decision)) throw new Error("invalid counterexample decision");
  const actor = assertAuthority(db, decided_by, "experience.promote");
  const counterexample = db.prepare("SELECT * FROM experience_counterexamples WHERE counterexample_id=?").get(counterexampleId);
  if (!counterexample) throw new Error("experience counterexample not found");
  if (counterexample.status !== "candidate") throw new Error("experience counterexample already decided");
  const experience = getExperience(db, counterexample.experience_id);
  const stamp = now(), status = decision === "confirm" ? "confirmed" : "rejected";
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE experience_counterexamples
      SET status=?,decided_by=?,decision_reason=?,decided_at=?
      WHERE counterexample_id=?
    `).run(status, actor, reason, stamp, counterexampleId);
    const affectsCurrent = decision === "confirm"
      && experience.status === "active"
      && experience.current_version_id === counterexample.affected_version_id;
    if (affectsCurrent) {
      db.prepare("UPDATE experience_versions SET status='superseded' WHERE version_id=?")
        .run(counterexample.affected_version_id);
      db.prepare("UPDATE experiences SET status='retired',current_version_id=NULL,updated_at=? WHERE experience_id=?")
        .run(stamp, experience.experience_id);
    } else {
      db.prepare("UPDATE experiences SET updated_at=? WHERE experience_id=?").run(stamp, experience.experience_id);
    }
    recordExperienceLifecycle(db, {
      experience_id: experience.experience_id,
      version_id: counterexample.affected_version_id,
      event_type: decision === "confirm" ? "counterexample_confirmed" : "counterexample_rejected",
      reason,
      evidence: [{ counterexample_id: counterexampleId }],
      actor,
      created_at: stamp,
    });
    appendEvent(db, "experience", experience.experience_id, `experience.counterexample_${status}`, {
      counterexample_id: counterexampleId,
      affected_version_id: counterexample.affected_version_id,
      retired_active_version: affectsCurrent,
      decided_by: actor,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getExperience(db, experience.experience_id);
}

export function evaluateExperienceUsage(db, usageId, {
  assessment,
  impact,
  evidence = [],
  evaluated_by = "creator",
} = {}) {
  if (!["helpful", "harmful", "neutral", "unclear"].includes(assessment)) {
    throw new Error("invalid experience usage assessment");
  }
  const actor = assertAuthority(db, evaluated_by, "formal_state.confirm");
  object(impact, "impact"); array(evidence, "evidence");
  const usage = db.prepare("SELECT * FROM experience_usages WHERE usage_id=?").get(usageId);
  if (!usage) throw new Error("experience usage not found");
  const judgment = db.prepare("SELECT status FROM judgments WHERE judgment_id=?").get(usage.judgment_id);
  if (!judgment || !["accepted", "corrected", "rejected"].includes(judgment.status)) {
    throw new Error("experience usage can be evaluated only after creator judgment feedback");
  }
  const evaluationId = newId("experience_evaluation"), stamp = now();
  const version = db.prepare("SELECT experience_id FROM experience_versions WHERE version_id=?")
    .get(usage.experience_version_id);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO experience_usage_evaluations(
        evaluation_id,usage_id,assessment,impact_json,evidence_json,evaluated_by,created_at
      ) VALUES (?,?,?,?,?,?,?)
    `).run(evaluationId, usageId, assessment, canonicalJson(impact), canonicalJson(evidence), actor, stamp);
    appendEvent(db, "experience", version.experience_id, "experience.usage_evaluated", {
      usage_id: usageId, evaluation_id: evaluationId, assessment, evaluated_by: actor,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getExperience(db, version.experience_id);
}
