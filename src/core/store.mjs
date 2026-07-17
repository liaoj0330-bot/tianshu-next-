import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations } from "./migrations.mjs";

export const now = () => new Date().toISOString();
export const newId = (prefix) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalize(value[key])]),
    );
  }
  return value;
}

export const canonicalJson = (value) => JSON.stringify(normalize(value));

export function openStore(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      goal_id TEXT PRIMARY KEY,
      contract_json TEXT NOT NULL,
      contract_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      plan_id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(goal_id),
      plan_json TEXT NOT NULL,
      plan_hash TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      approval_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL UNIQUE REFERENCES plans(plan_id),
      bound_plan_hash TEXT NOT NULL,
      decision TEXT NOT NULL,
      decided_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL UNIQUE REFERENCES plans(plan_id),
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(task_id),
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      executor_result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(task_id, attempt)
    );
    CREATE TABLE IF NOT EXISTS verifications (
      verification_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
      passed INTEGER NOT NULL,
      report_json TEXT NOT NULL,
      verifier TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decisions (
      decision_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      decided_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS state_subjects (
      subject_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      current_snapshot_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS state_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES state_subjects(subject_id),
      version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('current', 'historical')),
      state_json TEXT NOT NULL,
      source_json TEXT NOT NULL,
      cycle_id TEXT,
      created_at TEXT NOT NULL,
      superseded_at TEXT,
      UNIQUE(subject_id, version)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS state_snapshots_one_current
      ON state_snapshots(subject_id) WHERE status = 'current';
    CREATE TABLE IF NOT EXISTS state_update_cycles (
      cycle_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES state_subjects(subject_id),
      base_snapshot_id TEXT NOT NULL REFERENCES state_snapshots(snapshot_id),
      observed_at TEXT NOT NULL,
      input_json TEXT NOT NULL,
      comparison_json TEXT NOT NULL,
      proposed_state_json TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      next_action_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('awaiting_creator_decision', 'accepted', 'corrected', 'rejected')),
      accepted_snapshot_id TEXT,
      decision_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS state_questions (
      question_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES state_subjects(subject_id),
      question_key TEXT NOT NULL,
      question_text TEXT NOT NULL,
      why_it_matters TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'answered', 'superseded')),
      answer_json TEXT,
      first_cycle_id TEXT NOT NULL REFERENCES state_update_cycles(cycle_id),
      asked_at TEXT NOT NULL,
      answered_at TEXT,
      UNIQUE(subject_id, question_key)
    );
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      purpose TEXT,
      default_risk_level TEXT NOT NULL,
      approval_levels_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_paths (
      project_id TEXT NOT NULL REFERENCES projects(project_id),
      path TEXT NOT NULL,
      path_kind TEXT NOT NULL CHECK(path_kind IN ('allowed', 'context')),
      PRIMARY KEY(project_id, path, path_kind)
    );
    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','leased','running','cancel_requested','succeeded','failed','retry_wait','recovery_required','cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      available_at TEXT NOT NULL,
      lease_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worker_leases (
      lease_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(job_id),
      worker_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','expired','released')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_locks (
      project_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      lease_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS failure_cases (
      failure_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      code TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      command TEXT NOT NULL,
      command_args_json TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      agent_run_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(agent_id),
      job_id TEXT REFERENCES jobs(job_id),
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      exit_code INTEGER,
      stdout TEXT,
      stderr TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS intake_events (
      intake_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_candidates (
      candidate_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      statement TEXT NOT NULL,
      scope TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      counterexamples_json TEXT NOT NULL,
      source_ids_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('candidate','promoted','rejected')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creator_project_profiles (
      project_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      lane TEXT NOT NULL,
      baseline_priority INTEGER NOT NULL CHECK(baseline_priority BETWEEN 1 AND 5),
      execution_policy TEXT NOT NULL CHECK(execution_policy IN ('eligible_after_approval','read_only','no_access')),
      status TEXT NOT NULL CHECK(status IN ('active','waiting','auxiliary','protected')),
      evidence_json TEXT NOT NULL,
      source_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creator_priority_assessments (
      assessment_id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL REFERENCES creator_project_profiles(project_key),
      factors_json TEXT NOT NULL,
      score REAL NOT NULL,
      priority_band TEXT NOT NULL CHECK(priority_band IN ('focus_now','important','maintain','defer')),
      confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
      status TEXT NOT NULL CHECK(status IN ('candidate','confirmed','superseded')),
      source_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS creator_priority_one_current
      ON creator_priority_assessments(project_key) WHERE status IN ('candidate','confirmed');
    CREATE TABLE IF NOT EXISTS project_change_candidates (
      change_id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL REFERENCES creator_project_profiles(project_key),
      change_type TEXT NOT NULL CHECK(change_type IN ('stage','progress','risk','deadline','priority','status','note')),
      previous_json TEXT,
      proposed_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      impact_json TEXT NOT NULL,
      source_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
      status TEXT NOT NULL CHECK(status IN ('awaiting_creator_confirmation','accepted','rejected','superseded')),
      created_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT,
      decision_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS project_change_candidates_project_time
      ON project_change_candidates(project_key, created_at DESC);
    CREATE TABLE IF NOT EXISTS project_current_state (
      project_key TEXT NOT NULL REFERENCES creator_project_profiles(project_key),
      state_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      source_change_id TEXT NOT NULL REFERENCES project_change_candidates(change_id),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_key, state_key)
    );    CREATE TABLE IF NOT EXISTS project_observation_cursors (
      project_key TEXT NOT NULL REFERENCES creator_project_profiles(project_key),
      source_kind TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      PRIMARY KEY(project_key, source_kind)
    );    CREATE TABLE IF NOT EXISTS knowledge_entities (
      entity_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      canonical_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      access_policy TEXT NOT NULL CHECK(access_policy IN ('normal','read_only','protected')),
      status TEXT NOT NULL CHECK(status IN ('active','inactive','historical')),
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(entity_type, canonical_key)
    );
    CREATE TABLE IF NOT EXISTS knowledge_aliases (
      alias_id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES knowledge_entities(entity_id),
      alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(entity_id, normalized_alias)
    );
    CREATE INDEX IF NOT EXISTS knowledge_alias_lookup ON knowledge_aliases(normalized_alias);
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      source_id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      reference TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      access_policy TEXT NOT NULL CHECK(access_policy IN ('normal','read_only','protected')),
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(source_kind, reference, content_hash)
    );
    CREATE TABLE IF NOT EXISTS knowledge_evidence (
      evidence_id TEXT PRIMARY KEY,
      evidence_key TEXT NOT NULL UNIQUE,
      entity_id TEXT NOT NULL REFERENCES knowledge_entities(entity_id),
      source_id TEXT NOT NULL REFERENCES knowledge_sources(source_id),
      claim_type TEXT NOT NULL,
      value_json TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
      status TEXT NOT NULL CHECK(status IN ('candidate','confirmed','superseded','rejected')),
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_evidence_entity_status ON knowledge_evidence(entity_id,status,claim_type);
    CREATE TABLE IF NOT EXISTS knowledge_relations (
      relation_id TEXT PRIMARY KEY,
      from_entity_id TEXT NOT NULL REFERENCES knowledge_entities(entity_id),
      to_entity_id TEXT NOT NULL REFERENCES knowledge_entities(entity_id),
      relation_type TEXT NOT NULL,
      evidence_id TEXT REFERENCES knowledge_evidence(evidence_id),
      status TEXT NOT NULL CHECK(status IN ('candidate','confirmed','superseded','rejected')),
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(from_entity_id,to_entity_id,relation_type,evidence_id)
    );
    CREATE INDEX IF NOT EXISTS knowledge_relation_from ON knowledge_relations(from_entity_id,status);
    CREATE INDEX IF NOT EXISTS knowledge_relation_to ON knowledge_relations(to_entity_id,status);
    CREATE TABLE IF NOT EXISTS knowledge_terms (
      entity_id TEXT NOT NULL REFERENCES knowledge_entities(entity_id),
      term TEXT NOT NULL,
      normalized_term TEXT NOT NULL,
      weight REAL NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY(entity_id,normalized_term,source)
    );
    CREATE INDEX IF NOT EXISTS knowledge_term_lookup ON knowledge_terms(normalized_term);
    CREATE TABLE IF NOT EXISTS plan_candidates (
      candidate_id TEXT PRIMARY KEY,
      intake_id TEXT NOT NULL REFERENCES intake_events(intake_id),
      version INTEGER NOT NULL,
      candidate_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('awaiting_creator_confirmation','approved','rejected','superseded')),
      supersedes_id TEXT REFERENCES plan_candidates(candidate_id),
      revision_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(intake_id, version)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS plan_candidates_one_current
      ON plan_candidates(intake_id) WHERE status='awaiting_creator_confirmation';
    CREATE TABLE IF NOT EXISTS execution_boundaries (
      plan_id TEXT PRIMARY KEY REFERENCES plans(plan_id),
      boundary_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('awaiting_configuration','awaiting_creator_confirmation','approved','rejected')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS intake_confirmations (
      intake_id TEXT PRIMARY KEY REFERENCES intake_events(intake_id),
      confirmation_type TEXT NOT NULL,
      decision TEXT NOT NULL,
      entity_json TEXT,
      decided_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS continuation_checkpoints (
      checkpoint_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      objective TEXT NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('current','historical')),
      snapshot_json TEXT NOT NULL,
      source_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      superseded_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS continuation_one_current
      ON continuation_checkpoints(scope) WHERE status='current';
    CREATE TABLE IF NOT EXISTS problem_cases (
      problem_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      symptom TEXT NOT NULL,
      root_cause TEXT,
      resolution TEXT,
      recurrence_playbook TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open','resolved','monitoring')),
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      source_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evolution_candidates (
      candidate_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('operational_rule','content_idea')),
      title TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('candidate','promoted','rejected')),
      source_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );    CREATE TRIGGER IF NOT EXISTS goals_contract_immutable
    BEFORE UPDATE OF contract_json, contract_hash ON goals
    BEGIN
      SELECT RAISE(ABORT, 'goal contract is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS plans_spec_immutable
    BEFORE UPDATE OF plan_json, plan_hash, risk_level ON plans
    BEGIN
      SELECT RAISE(ABORT, 'approved plan specification is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS events_no_update
    BEFORE UPDATE ON events
    BEGIN
      SELECT RAISE(ABORT, 'events are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS events_no_delete
    BEFORE DELETE ON events
    BEGIN
      SELECT RAISE(ABORT, 'events are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS state_snapshots_content_immutable
    BEFORE UPDATE OF subject_id, version, state_json, source_json, cycle_id, created_at ON state_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'state snapshot content is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS state_snapshots_no_delete
    BEFORE DELETE ON state_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'state snapshots are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS state_cycles_proposal_immutable
    BEFORE UPDATE OF subject_id, base_snapshot_id, observed_at, input_json, comparison_json,
      proposed_state_json, questions_json, next_action_json, created_at ON state_update_cycles
    BEGIN
      SELECT RAISE(ABORT, 'state update proposal is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS state_cycles_no_delete
    BEFORE DELETE ON state_update_cycles
    BEGIN
      SELECT RAISE(ABORT, 'state update cycles are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS state_questions_no_delete
    BEFORE DELETE ON state_questions
    BEGIN
      SELECT RAISE(ABORT, 'state questions are append-only');
    END;
  `);
  const legacyLeaseConstraint = db.prepare("PRAGMA index_list(worker_leases)").all().some((index) => index.unique === 1 && index.origin === "u");
  if (legacyLeaseConstraint) {
    db.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE; ALTER TABLE worker_leases RENAME TO worker_leases_legacy; CREATE TABLE worker_leases (lease_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(job_id), worker_id TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','expired','released')), created_at TEXT NOT NULL); INSERT INTO worker_leases SELECT * FROM worker_leases_legacy; DROP TABLE worker_leases_legacy; COMMIT; PRAGMA foreign_keys = ON;");
  }
  applyMigrations(db);
  return db;
}

export function appendEvent(db, entityType, entityId, eventType, payload = {}) {
  db.prepare(`
    INSERT INTO events(entity_type, entity_id, event_type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(entityType, entityId, eventType, canonicalJson(payload), now());
}

export function getOne(db, table, key, value) {
  return db.prepare(`SELECT * FROM ${table} WHERE ${key} = ?`).get(value);
}

export function recordArtifact(db, runId, kind, path) {
  const artifactId = newId("artifact");
  const metadata = statSync(path);
  const digest = sha256(readFileSync(path));
  db.prepare(`
    INSERT INTO artifacts(artifact_id, run_id, kind, path, sha256, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(artifactId, runId, kind, path, digest, metadata.size, now());
  appendEvent(db, "run", runId, "artifact.recorded", {
    artifact_id: artifactId,
    kind,
    sha256: digest,
  });
  return artifactId;
}
