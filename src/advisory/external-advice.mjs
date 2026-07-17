import { appendEvent, canonicalJson, newId, now } from "../core/store.mjs";
import { assertAuthority } from "../governance/authority.mjs";

const parse = (value, fallback = {}) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

function required(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function decorateRecommendation(row) {
  if (!row) return null;
  const decisionRow = row.decision_id ? {
    decision_id: row.decision_id,
    disposition: row.final_disposition,
    adaptation: parse(row.final_adaptation_json, {}),
    reason: row.decision_reason,
    decided_by: row.decided_by,
    created_at: row.decided_at,
  } : null;
  const {
    decision_id, final_disposition, final_adaptation_json,
    decision_reason, decided_by, decided_at, ...recommendation
  } = row;
  return {
    ...recommendation,
    proposed_adaptation: parse(row.proposed_adaptation_json, {}),
    decision: decisionRow,
  };
}

export function getAdvisorySource(db, sourceId) {
  const source = db.prepare("SELECT * FROM advisory_sources WHERE source_id=?").get(sourceId);
  if (!source) return null;
  return {
    ...source,
    metadata: parse(source.metadata_json, {}),
    recommendations: db.prepare(`
      SELECT r.*,d.decision_id,d.disposition final_disposition,
             d.adaptation_json final_adaptation_json,d.reason decision_reason,
             d.decided_by,d.created_at decided_at
      FROM advisory_recommendations r
      LEFT JOIN advisory_decisions d ON d.recommendation_id=r.recommendation_id
      WHERE r.source_id=? ORDER BY r.priority,r.created_at,r.recommendation_key
    `).all(sourceId).map(decorateRecommendation),
  };
}

export function ingestAdvisoryDocument(db, {
  source_kind = "external_document",
  document_id,
  title,
  author,
  external_ref,
  content_hash,
  observed_at = now(),
  trust_scope = "advisory_only",
  metadata = {},
  recommendations = [],
  created_by = "tianshu_orchestrator",
} = {}) {
  const actor = assertAuthority(db, created_by, "machine_state.transition");
  if (!Array.isArray(recommendations) || !recommendations.length) throw new Error("advisory document requires recommendations");
  const existing = db.prepare(`
    SELECT source_id FROM advisory_sources
    WHERE source_kind=? AND external_ref=? AND content_hash=?
  `).get(source_kind, external_ref, content_hash);
  if (existing) return getAdvisorySource(db, existing.source_id);
  const sourceId = newId("advisory_source"), stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO advisory_sources(
        source_id,source_kind,document_id,title,author,external_ref,content_hash,
        observed_at,trust_scope,metadata_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      sourceId, required(source_kind, "source_kind"), required(document_id, "document_id"),
      required(title, "title"), required(author, "author"), required(external_ref, "external_ref"),
      required(content_hash, "content_hash"), observed_at, required(trust_scope, "trust_scope"),
      canonicalJson(metadata), stamp,
    );
    for (const item of recommendations) {
      if (!["adopt", "adapt", "defer", "reject"].includes(item.proposed_disposition)) {
        throw new Error("invalid proposed advisory disposition");
      }
      if (!["now", "next", "later", "never"].includes(item.priority)) throw new Error("invalid advisory priority");
      db.prepare(`
        INSERT INTO advisory_recommendations(
          recommendation_id,source_id,recommendation_key,topic,original_claim,
          assessment,proposed_disposition,proposed_adaptation_json,priority,status,
          created_by,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,'awaiting_creator_decision',?,?,?)
      `).run(
        newId("advisory_recommendation"), sourceId,
        required(item.recommendation_key, "recommendation_key"), required(item.topic, "topic"),
        required(item.original_claim, "original_claim"), required(item.assessment, "assessment"),
        item.proposed_disposition, canonicalJson(item.proposed_adaptation ?? {}), item.priority,
        actor, stamp, stamp,
      );
    }
    appendEvent(db, "advisory_source", sourceId, "advisory_source.ingested", {
      document_id, content_hash, recommendation_count: recommendations.length, created_by: actor,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getAdvisorySource(db, sourceId);
}

export function decideAdvisoryRecommendation(db, recommendationId, {
  disposition,
  adaptation = {},
  reason = "",
  decided_by = "creator",
} = {}) {
  if (!["adopt", "adapt", "defer", "reject"].includes(disposition)) throw new Error("invalid advisory disposition");
  if (disposition === "adapt" && (!adaptation || typeof adaptation !== "object" || !Object.keys(adaptation).length)) {
    throw new Error("adapt disposition requires an adaptation");
  }
  const actor = assertAuthority(db, decided_by, "formal_state.confirm");
  const recommendation = db.prepare("SELECT * FROM advisory_recommendations WHERE recommendation_id=?").get(recommendationId);
  if (!recommendation) throw new Error("advisory recommendation not found");
  if (recommendation.status !== "awaiting_creator_decision") throw new Error("advisory recommendation already decided");
  const status = { adopt: "adopted", adapt: "adapted", defer: "deferred", reject: "rejected" }[disposition];
  const stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO advisory_decisions VALUES (?,?,?,?,?,?,?)")
      .run(newId("advisory_decision"), recommendationId, disposition, canonicalJson(adaptation ?? {}), reason, actor, stamp);
    db.prepare("UPDATE advisory_recommendations SET status=?,updated_at=? WHERE recommendation_id=?")
      .run(status, stamp, recommendationId);
    appendEvent(db, "advisory_recommendation", recommendationId, `advisory_recommendation.${status}`, {
      disposition, decided_by: actor, reason,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listAdvisoryRecommendations(db, { recommendation_id: recommendationId })[0];
}

export function listAdvisoryRecommendations(db, { status = null, recommendation_id = null } = {}) {
  const clauses = [], values = [];
  if (status) { clauses.push("r.status=?"); values.push(status); }
  if (recommendation_id) { clauses.push("r.recommendation_id=?"); values.push(recommendation_id); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT r.*,s.document_id,s.title source_title,s.author,s.external_ref,s.content_hash,
           d.decision_id,d.disposition final_disposition,d.adaptation_json final_adaptation_json,
           d.reason decision_reason,d.decided_by,d.created_at decided_at
    FROM advisory_recommendations r
    JOIN advisory_sources s ON s.source_id=r.source_id
    LEFT JOIN advisory_decisions d ON d.recommendation_id=r.recommendation_id
    ${where}
    ORDER BY CASE r.priority WHEN 'now' THEN 1 WHEN 'next' THEN 2 WHEN 'later' THEN 3 ELSE 4 END,
             r.created_at,r.recommendation_key
  `).all(...values).map(decorateRecommendation);
}
