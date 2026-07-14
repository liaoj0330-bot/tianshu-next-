import { canonicalJson, newId, now, sha256, appendEvent } from "../core/store.mjs";

function parse(value, fallback = null) { if (!value) return fallback; return JSON.parse(value); }
function required(value, name) { if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`); return value.trim(); }
let transactionCounter = 0;
function transaction(db, work) {
  if (db.isTransaction) {
    const savepoint = `continuity_${++transactionCounter}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try { const result = work(); db.exec(`RELEASE ${savepoint}`); return result; }
    catch (error) { db.exec(`ROLLBACK TO ${savepoint}`); db.exec(`RELEASE ${savepoint}`); throw error; }
  }
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function recordProblemCase(db, input) {
  const title = required(input.title, "problem title");
  const symptom = required(input.symptom, "problem symptom");
  const playbook = required(input.recurrence_playbook, "recurrence playbook");
  const fingerprint = input.fingerprint ?? sha256(canonicalJson({ title, symptom })).slice(0, 24);
  const existing = db.prepare("SELECT * FROM problem_cases WHERE fingerprint=?").get(fingerprint);
  const stamp = now();
  if (existing) {
    db.prepare(`UPDATE problem_cases SET title=?,symptom=?,root_cause=?,resolution=?,recurrence_playbook=?,validation_json=?,status=?,occurrence_count=occurrence_count+1,source_json=?,updated_at=? WHERE problem_id=?`).run(
      title, symptom, input.root_cause ?? existing.root_cause, input.resolution ?? existing.resolution, playbook,
      canonicalJson(input.validation ?? parse(existing.validation_json, [])), input.status ?? existing.status,
      canonicalJson(input.source ?? parse(existing.source_json, {})), stamp, existing.problem_id,
    );
    appendEvent(db, "problem", existing.problem_id, "problem.recurred", { fingerprint });
    return getProblem(db, existing.problem_id);
  }
  const problemId = newId("problem");
  db.prepare("INSERT INTO problem_cases VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)").run(
    problemId, fingerprint, title, symptom, input.root_cause ?? null, input.resolution ?? null, playbook,
    canonicalJson(input.validation ?? []), input.status ?? "open", canonicalJson(input.source ?? {}), stamp, stamp,
  );
  appendEvent(db, "problem", problemId, "problem.recorded", { fingerprint });
  return getProblem(db, problemId);
}

export function getProblem(db, problemId) {
  const row = db.prepare("SELECT * FROM problem_cases WHERE problem_id=?").get(problemId);
  return row ? { ...row, validation: parse(row.validation_json, []), source: parse(row.source_json, {}) } : null;
}

export function listProblems(db, { status } = {}) {
  const rows = status ? db.prepare("SELECT * FROM problem_cases WHERE status=? ORDER BY updated_at DESC").all(status) : db.prepare("SELECT * FROM problem_cases ORDER BY updated_at DESC").all();
  return rows.map((row) => ({ ...row, validation: parse(row.validation_json, []), source: parse(row.source_json, {}) }));
}

export function recordEvolutionCandidate(db, input) {
  if (!["operational_rule", "content_idea"].includes(input.kind)) throw new Error("invalid evolution candidate kind");
  const candidateId = newId("evolution"); const stamp = now();
  db.prepare("INSERT INTO evolution_candidates VALUES (?,?,?,?, 'candidate', ?, ?, ?)").run(candidateId, input.kind, required(input.title, "candidate title"), canonicalJson(input.payload ?? {}), canonicalJson(input.source ?? {}), stamp, stamp);
  appendEvent(db, "evolution_candidate", candidateId, "evolution.candidate_recorded", { kind: input.kind });
  return { candidate_id: candidateId, kind: input.kind, title: input.title, payload: input.payload ?? {}, status: "candidate", source: input.source ?? {}, created_at: stamp, updated_at: stamp };
}

export function listEvolutionCandidates(db, kind = null) {
  const rows = kind ? db.prepare("SELECT * FROM evolution_candidates WHERE kind=? AND status='candidate' ORDER BY created_at DESC").all(kind) : db.prepare("SELECT * FROM evolution_candidates WHERE status='candidate' ORDER BY created_at DESC").all();
  return rows.map((row) => ({ ...row, payload: parse(row.payload_json, {}), source: parse(row.source_json, {}) }));
}

export function createContinuationCheckpoint(db, input) {
  const scope = required(input.scope, "checkpoint scope"); const objective = required(input.objective, "checkpoint objective"); const phase = required(input.phase, "checkpoint phase");
  const snapshot = {
    completed: input.completed ?? [], in_progress: input.in_progress ?? [], blockers: input.blockers ?? [],
    next_action: required(input.next_action, "next action"), pending_confirmations: input.pending_confirmations ?? [],
    evidence: input.evidence ?? [], repositories: input.repositories ?? [], services: input.services ?? [],
    protected_boundaries: input.protected_boundaries ?? [], acceptance_state: input.acceptance_state ?? "not_verified",
  };
  return transaction(db, () => {
    const stamp = now();
    db.prepare("UPDATE continuation_checkpoints SET status='historical',superseded_at=? WHERE scope=? AND status='current'").run(stamp, scope);
    const checkpointId = newId("checkpoint");
    db.prepare("INSERT INTO continuation_checkpoints VALUES (?,?,?,?,'current',?,?,?,NULL)").run(checkpointId, scope, objective, phase, canonicalJson(snapshot), canonicalJson(input.source ?? {}), stamp);
    appendEvent(db, "checkpoint", checkpointId, "continuation.checkpoint_created", { scope, phase });
    return { checkpoint_id: checkpointId, scope, objective, phase, status: "current", snapshot, source: input.source ?? {}, created_at: stamp };
  });
}

export function buildResumePacket(db, scope = "tianshu") {
  const row = db.prepare("SELECT * FROM continuation_checkpoints WHERE scope=? AND status='current'").get(scope);
  const checkpoint = row ? { checkpoint_id: row.checkpoint_id, scope: row.scope, objective: row.objective, phase: row.phase, created_at: row.created_at, snapshot: parse(row.snapshot_json, {}), source: parse(row.source_json, {}) } : null;
  const pendingState = db.prepare("SELECT cycle_id,subject_id,created_at FROM state_update_cycles WHERE status='awaiting_creator_decision' ORDER BY created_at DESC").all();
  const pendingPlans = db.prepare("SELECT candidate_id,intake_id,version,created_at FROM plan_candidates WHERE status='awaiting_creator_confirmation' ORDER BY created_at DESC").all();
  const activeJobs = db.prepare("SELECT job_id,project_id,status,attempts,max_attempts,updated_at FROM jobs WHERE status NOT IN ('succeeded','failed','cancelled') ORDER BY updated_at DESC").all();
  return {
    state_authority: "sqlite", generated_at: now(), scope, checkpoint,
    unresolved_problems: listProblems(db).filter((item) => item.status !== "resolved"),
    pending_confirmations: { state: pendingState, plans: pendingPlans }, active_jobs: activeJobs,
    evolution_candidates: listEvolutionCandidates(db),
    recent_events: db.prepare("SELECT entity_type,entity_id,event_type,created_at FROM events ORDER BY event_id DESC LIMIT 12").all(),
    can_resume: Boolean(checkpoint),
    resume_instruction: checkpoint ? `从“${checkpoint.snapshot.next_action}”继续；先核对阻塞、Git、服务和验收状态，不重新规划已完成工作。` : "尚无继续执行检查点，先建立目标、边界和下一步。",
  };
}

export function closeTurn(db, input) {
  return transaction(db, () => {
    const problems = (input.problems ?? []).map((item) => recordProblemCase(db, { ...item, source: item.source ?? input.source }));
    const candidates = (input.evolution_candidates ?? []).map((item) => recordEvolutionCandidate(db, { ...item, source: item.source ?? input.source }));
    const checkpoint = createContinuationCheckpoint(db, { ...input.checkpoint, source: input.checkpoint?.source ?? input.source });
    return { checkpoint, problems, evolution_candidates: candidates, execution_started: false, state_authority: "sqlite" };
  });
}