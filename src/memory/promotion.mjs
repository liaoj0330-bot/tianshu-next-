import { canonicalJson, newId, now } from "../core/store.mjs";

export function recordMemoryCandidate(db, { subject_id, statement, scope = "project", source_id = null }) {
  if (!subject_id || !statement) throw new Error("memory candidate requires subject_id and statement");
  const existing = db.prepare("SELECT * FROM memory_candidates WHERE subject_id=? AND statement=? AND scope=? AND status='candidate'").get(subject_id, statement, scope);
  if (existing) {
    const sources = JSON.parse(existing.source_ids_json); if (source_id && !sources.includes(source_id)) sources.push(source_id);
    db.prepare("UPDATE memory_candidates SET occurrence_count=?,source_ids_json=?,updated_at=? WHERE candidate_id=?").run(existing.occurrence_count + 1, canonicalJson(sources), now(), existing.candidate_id);
    return { ...existing, occurrence_count: existing.occurrence_count + 1, source_ids: sources };
  }
  const candidateId = newId("memory"); const timestamp = now();
  db.prepare("INSERT INTO memory_candidates VALUES (?, ?, ?, ?, 1, ?, ?, 'candidate', ?, ?)").run(candidateId, subject_id, statement, scope, "[]", canonicalJson(source_id ? [source_id] : []), timestamp, timestamp);
  return { candidate_id: candidateId, subject_id, statement, scope, occurrence_count: 1, status: "candidate", source_ids: source_id ? [source_id] : [] };
}

export function addMemoryCounterexample(db, candidateId, counterexample) {
  const row = db.prepare("SELECT * FROM memory_candidates WHERE candidate_id=?").get(candidateId); if (!row) throw new Error("memory candidate not found");
  const values = JSON.parse(row.counterexamples_json); values.push(counterexample);
  db.prepare("UPDATE memory_candidates SET counterexamples_json=?,updated_at=? WHERE candidate_id=?").run(canonicalJson(values), now(), candidateId);
}

export function promoteMemoryCandidate(db, candidateId, promotedBy = "creator") {
  const row = db.prepare("SELECT * FROM memory_candidates WHERE candidate_id=?").get(candidateId); if (!row) throw new Error("memory candidate not found");
  if (row.occurrence_count < 3) throw new Error("memory candidate requires three occurrences");
  if (JSON.parse(row.counterexamples_json).length) throw new Error("memory candidate has counterexamples");
  db.prepare("UPDATE memory_candidates SET status='promoted',updated_at=? WHERE candidate_id=?").run(now(), candidateId);
  return { candidate_id: candidateId, statement: row.statement, scope: row.scope, promoted_by: promotedBy, status: "promoted" };
}

export function listMemoryCandidates(db, subjectId) {
  return db.prepare("SELECT * FROM memory_candidates WHERE subject_id=? ORDER BY updated_at DESC").all(subjectId).map((row) => ({ ...row, counterexamples: JSON.parse(row.counterexamples_json), source_ids: JSON.parse(row.source_ids_json) }));
}
