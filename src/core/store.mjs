import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
      created_at TEXT NOT NULL,
      UNIQUE(job_id)
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
    CREATE TRIGGER IF NOT EXISTS goals_contract_immutable
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
