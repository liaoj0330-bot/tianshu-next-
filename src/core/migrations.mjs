import { createHash } from "node:crypto";
import { AUTHORITY_BASELINE_V1 } from "../governance/authority.mjs";

const MIGRATIONS = Object.freeze([
  {
    version: 1,
    name: "authority_and_workspace_assignments",
    sql: `
      CREATE TABLE authority_policies (
        policy_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        principal_kind TEXT NOT NULL,
        capability TEXT NOT NULL,
        effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
        requires_creator_confirmation INTEGER NOT NULL CHECK(requires_creator_confirmation IN (0,1)),
        rationale TEXT NOT NULL,
        policy_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','superseded')),
        created_at TEXT NOT NULL,
        UNIQUE(principal_id, capability, policy_version)
      );
      CREATE INDEX authority_policies_active
        ON authority_policies(principal_id, capability, status);
      CREATE TABLE workspace_assignments (
        assignment_id TEXT PRIMARY KEY,
        intake_id TEXT NOT NULL UNIQUE REFERENCES intake_events(intake_id),
        proposed_workspace TEXT NOT NULL CHECK(proposed_workspace IN ('today','projects','life','relationships','knowledge','evolution','activity','inbox')),
        effective_workspace TEXT NOT NULL CHECK(effective_workspace IN ('today','projects','life','relationships','knowledge','evolution','activity','inbox')),
        status TEXT NOT NULL CHECK(status IN ('classified','needs_creator_confirmation','unresolved','confirmed','corrected')),
        confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
        candidates_json TEXT NOT NULL,
        reason_codes_json TEXT NOT NULL,
        classified_by TEXT NOT NULL,
        source TEXT NOT NULL,
        decided_by TEXT,
        decision_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX workspace_assignments_status
        ON workspace_assignments(status, updated_at DESC);
      CREATE TABLE workspace_assignment_revisions (
        revision_id TEXT PRIMARY KEY,
        assignment_id TEXT NOT NULL REFERENCES workspace_assignments(assignment_id),
        version INTEGER NOT NULL,
        workspace TEXT NOT NULL CHECK(workspace IN ('today','projects','life','relationships','knowledge','evolution','activity','inbox')),
        decision TEXT NOT NULL CHECK(decision IN ('classified','confirm','correct')),
        decided_by TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(assignment_id, version)
      );
      CREATE TRIGGER workspace_assignment_revisions_no_update
      BEFORE UPDATE ON workspace_assignment_revisions
      BEGIN SELECT RAISE(ABORT, 'workspace assignment revisions are append-only'); END;
      CREATE TRIGGER workspace_assignment_revisions_no_delete
      BEFORE DELETE ON workspace_assignment_revisions
      BEGIN SELECT RAISE(ABORT, 'workspace assignment revisions are append-only'); END;
    `,
  },
  {
    version: 2,
    name: "judgment_outcome_experience_loop",
    sql: `
      CREATE TABLE judgments (
        judgment_id TEXT PRIMARY KEY,
        intake_id TEXT REFERENCES intake_events(intake_id),
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        workspace TEXT NOT NULL CHECK(workspace IN ('today','projects','life','relationships','knowledge','evolution','activity','inbox')),
        question TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        inferences_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        uncertainties_json TEXT NOT NULL,
        alternatives_json TEXT NOT NULL,
        recommendation_json TEXT NOT NULL,
        confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
        status TEXT NOT NULL CHECK(status IN ('awaiting_creator_feedback','accepted','corrected','rejected','deferred')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX judgments_status_time ON judgments(status, created_at DESC);
      CREATE INDEX judgments_subject_time ON judgments(subject_type, subject_id, created_at DESC);
      CREATE TABLE judgment_feedback (
        feedback_id TEXT PRIMARY KEY,
        judgment_id TEXT NOT NULL REFERENCES judgments(judgment_id),
        decision TEXT NOT NULL CHECK(decision IN ('accept','correct','reject','defer')),
        correction_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        decided_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(judgment_id)
      );
      CREATE TABLE judgment_experience_citations (
        citation_id TEXT PRIMARY KEY,
        judgment_id TEXT NOT NULL REFERENCES judgments(judgment_id),
        experience_version_id TEXT NOT NULL REFERENCES experience_versions(version_id),
        influence_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(judgment_id, experience_version_id)
      );
      CREATE TABLE outcomes (
        outcome_id TEXT PRIMARY KEY,
        judgment_id TEXT NOT NULL REFERENCES judgments(judgment_id),
        goal_id TEXT REFERENCES goals(goal_id),
        run_id TEXT REFERENCES runs(run_id),
        summary TEXT NOT NULL,
        result_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('candidate','confirmed','corrected','rejected')),
        recorded_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX outcomes_judgment_time ON outcomes(judgment_id, created_at DESC);
      CREATE TABLE outcome_decisions (
        decision_id TEXT PRIMARY KEY,
        outcome_id TEXT NOT NULL UNIQUE REFERENCES outcomes(outcome_id),
        decision TEXT NOT NULL CHECK(decision IN ('confirm','correct','reject')),
        correction_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        decided_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE experiences (
        experience_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('candidate','active','retired','rejected')),
        current_version_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE experience_versions (
        version_id TEXT PRIMARY KEY,
        experience_id TEXT NOT NULL REFERENCES experiences(experience_id),
        version INTEGER NOT NULL,
        rule_json TEXT NOT NULL,
        source_outcomes_json TEXT NOT NULL,
        counterexamples_json TEXT NOT NULL,
        applicability_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('candidate','active','superseded','rejected')),
        created_by TEXT NOT NULL,
        decided_by TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        UNIQUE(experience_id, version)
      );
      CREATE UNIQUE INDEX experience_one_active_version
        ON experience_versions(experience_id) WHERE status='active';
      CREATE TABLE experience_usages (
        usage_id TEXT PRIMARY KEY,
        experience_version_id TEXT NOT NULL REFERENCES experience_versions(version_id),
        judgment_id TEXT NOT NULL REFERENCES judgments(judgment_id),
        influence_json TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        evaluated_at TEXT,
        UNIQUE(experience_version_id, judgment_id)
      );
      CREATE TRIGGER judgments_content_immutable
      BEFORE UPDATE OF intake_id,subject_type,subject_id,workspace,question,facts_json,
        inferences_json,evidence_json,uncertainties_json,alternatives_json,
        recommendation_json,confidence,created_by,created_at ON judgments
      BEGIN SELECT RAISE(ABORT, 'judgment content is immutable'); END;
      CREATE TRIGGER judgments_no_delete BEFORE DELETE ON judgments
      BEGIN SELECT RAISE(ABORT, 'judgments are append-only'); END;
      CREATE TRIGGER judgment_feedback_no_update BEFORE UPDATE ON judgment_feedback
      BEGIN SELECT RAISE(ABORT, 'judgment feedback is append-only'); END;
      CREATE TRIGGER judgment_feedback_no_delete BEFORE DELETE ON judgment_feedback
      BEGIN SELECT RAISE(ABORT, 'judgment feedback is append-only'); END;
      CREATE TRIGGER judgment_citations_no_update BEFORE UPDATE ON judgment_experience_citations
      BEGIN SELECT RAISE(ABORT, 'judgment citations are append-only'); END;
      CREATE TRIGGER judgment_citations_no_delete BEFORE DELETE ON judgment_experience_citations
      BEGIN SELECT RAISE(ABORT, 'judgment citations are append-only'); END;
      CREATE TRIGGER outcomes_content_immutable
      BEFORE UPDATE OF judgment_id,goal_id,run_id,summary,result_json,evidence_json,
        recorded_by,created_at ON outcomes
      BEGIN SELECT RAISE(ABORT, 'outcome content is immutable'); END;
      CREATE TRIGGER outcomes_no_delete BEFORE DELETE ON outcomes
      BEGIN SELECT RAISE(ABORT, 'outcomes are append-only'); END;
      CREATE TRIGGER outcome_decisions_no_update BEFORE UPDATE ON outcome_decisions
      BEGIN SELECT RAISE(ABORT, 'outcome decisions are append-only'); END;
      CREATE TRIGGER outcome_decisions_no_delete BEFORE DELETE ON outcome_decisions
      BEGIN SELECT RAISE(ABORT, 'outcome decisions are append-only'); END;
      CREATE TRIGGER experience_versions_content_immutable
      BEFORE UPDATE OF experience_id,version,rule_json,source_outcomes_json,
        counterexamples_json,applicability_json,created_by,created_at ON experience_versions
      BEGIN SELECT RAISE(ABORT, 'experience version content is immutable'); END;
      CREATE TRIGGER experience_versions_no_delete BEFORE DELETE ON experience_versions
      BEGIN SELECT RAISE(ABORT, 'experience versions are append-only'); END;
      CREATE TRIGGER experience_usages_no_delete BEFORE DELETE ON experience_usages
      BEGIN SELECT RAISE(ABORT, 'experience usages are append-only'); END;
    `,
  },
  {
    version: 3,
    name: "governed_external_advice",
    sql: `
      CREATE TABLE advisory_sources (
        source_id TEXT PRIMARY KEY,
        source_kind TEXT NOT NULL,
        document_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        external_ref TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        trust_scope TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(source_kind, external_ref, content_hash)
      );
      CREATE TABLE advisory_recommendations (
        recommendation_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES advisory_sources(source_id),
        recommendation_key TEXT NOT NULL,
        topic TEXT NOT NULL,
        original_claim TEXT NOT NULL,
        assessment TEXT NOT NULL,
        proposed_disposition TEXT NOT NULL CHECK(proposed_disposition IN ('adopt','adapt','defer','reject')),
        proposed_adaptation_json TEXT NOT NULL,
        priority TEXT NOT NULL CHECK(priority IN ('now','next','later','never')),
        status TEXT NOT NULL CHECK(status IN ('awaiting_creator_decision','adopted','adapted','deferred','rejected')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, recommendation_key)
      );
      CREATE INDEX advisory_recommendations_status_priority
        ON advisory_recommendations(status, priority, created_at);
      CREATE TABLE advisory_decisions (
        decision_id TEXT PRIMARY KEY,
        recommendation_id TEXT NOT NULL UNIQUE REFERENCES advisory_recommendations(recommendation_id),
        disposition TEXT NOT NULL CHECK(disposition IN ('adopt','adapt','defer','reject')),
        adaptation_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        decided_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TRIGGER advisory_sources_no_update BEFORE UPDATE ON advisory_sources
      BEGIN SELECT RAISE(ABORT, 'advisory sources are append-only'); END;
      CREATE TRIGGER advisory_sources_no_delete BEFORE DELETE ON advisory_sources
      BEGIN SELECT RAISE(ABORT, 'advisory sources are append-only'); END;
      CREATE TRIGGER advisory_recommendations_content_immutable
      BEFORE UPDATE OF source_id,recommendation_key,topic,original_claim,assessment,
        proposed_disposition,proposed_adaptation_json,priority,created_by,created_at
        ON advisory_recommendations
      BEGIN SELECT RAISE(ABORT, 'advisory recommendation content is immutable'); END;
      CREATE TRIGGER advisory_recommendations_no_delete BEFORE DELETE ON advisory_recommendations
      BEGIN SELECT RAISE(ABORT, 'advisory recommendations are append-only'); END;
      CREATE TRIGGER advisory_decisions_no_update BEFORE UPDATE ON advisory_decisions
      BEGIN SELECT RAISE(ABORT, 'advisory decisions are append-only'); END;
      CREATE TRIGGER advisory_decisions_no_delete BEFORE DELETE ON advisory_decisions
      BEGIN SELECT RAISE(ABORT, 'advisory decisions are append-only'); END;
    `,
  },
  {
    version: 4,
    name: "agenthub_interaction_contract",
    sql: `
      CREATE TABLE interaction_sessions (
        session_id TEXT PRIMARY KEY,
        channel TEXT NOT NULL CHECK(channel IN ('agenthub')),
        conversation_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_kind TEXT NOT NULL CHECK(actor_kind IN ('creator','system')),
        status TEXT NOT NULL CHECK(status IN ('active','closed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(channel, conversation_id, actor_id)
      );
      CREATE TABLE interaction_requests (
        request_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES interaction_sessions(session_id),
        channel TEXT NOT NULL CHECK(channel IN ('agenthub')),
        message_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        intake_id TEXT REFERENCES intake_events(intake_id),
        status TEXT NOT NULL CHECK(status IN ('processing','accepted','failed')),
        response_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(channel, message_id),
        UNIQUE(channel, idempotency_key)
      );
      CREATE INDEX interaction_requests_session_created
        ON interaction_requests(session_id, created_at);
      CREATE TRIGGER interaction_requests_identity_immutable
      BEFORE UPDATE OF session_id,channel,message_id,idempotency_key,request_hash,created_at
        ON interaction_requests
      BEGIN SELECT RAISE(ABORT, 'interaction request identity is immutable'); END;
      CREATE TRIGGER interaction_requests_no_delete BEFORE DELETE ON interaction_requests
      BEGIN SELECT RAISE(ABORT, 'interaction requests are append-only'); END;
    `,
  },
  {
    version: 5,
    name: "experience_lifecycle_governance",
    sql: `
      CREATE TABLE judgment_feedback_extensions (
        extension_id TEXT PRIMARY KEY,
        feedback_id TEXT NOT NULL UNIQUE REFERENCES judgment_feedback(feedback_id),
        semantic_decision TEXT NOT NULL CHECK(semantic_decision IN ('ignore')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE experience_lifecycle_events (
        lifecycle_event_id TEXT PRIMARY KEY,
        experience_id TEXT NOT NULL REFERENCES experiences(experience_id),
        version_id TEXT REFERENCES experience_versions(version_id),
        event_type TEXT NOT NULL CHECK(event_type IN (
          'candidate_created','version_proposed','activated','rejected','withdrawn',
          'retired','counterexample_confirmed','counterexample_rejected','rolled_back'
        )),
        from_version_id TEXT REFERENCES experience_versions(version_id),
        reason TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX experience_lifecycle_experience_time
        ON experience_lifecycle_events(experience_id, created_at, lifecycle_event_id);
      CREATE TABLE experience_counterexamples (
        counterexample_id TEXT PRIMARY KEY,
        experience_id TEXT NOT NULL REFERENCES experiences(experience_id),
        affected_version_id TEXT NOT NULL REFERENCES experience_versions(version_id),
        observation_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('candidate','confirmed','rejected')),
        proposed_by TEXT NOT NULL,
        decided_by TEXT,
        decision_reason TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX experience_counterexamples_status_time
        ON experience_counterexamples(status, created_at);
      CREATE TABLE experience_usage_evaluations (
        evaluation_id TEXT PRIMARY KEY,
        usage_id TEXT NOT NULL UNIQUE REFERENCES experience_usages(usage_id),
        assessment TEXT NOT NULL CHECK(assessment IN ('helpful','harmful','neutral','unclear')),
        impact_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        evaluated_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TRIGGER experience_lifecycle_events_no_update
      BEFORE UPDATE ON experience_lifecycle_events
      BEGIN SELECT RAISE(ABORT, 'experience lifecycle events are append-only'); END;
      CREATE TRIGGER judgment_feedback_extensions_no_update
      BEFORE UPDATE ON judgment_feedback_extensions
      BEGIN SELECT RAISE(ABORT, 'judgment feedback extensions are append-only'); END;
      CREATE TRIGGER judgment_feedback_extensions_no_delete
      BEFORE DELETE ON judgment_feedback_extensions
      BEGIN SELECT RAISE(ABORT, 'judgment feedback extensions are append-only'); END;
      CREATE TRIGGER experience_lifecycle_events_no_delete
      BEFORE DELETE ON experience_lifecycle_events
      BEGIN SELECT RAISE(ABORT, 'experience lifecycle events are append-only'); END;
      CREATE TRIGGER experience_counterexamples_content_immutable
      BEFORE UPDATE OF experience_id,affected_version_id,observation_json,evidence_json,
        proposed_by,created_at ON experience_counterexamples
      BEGIN SELECT RAISE(ABORT, 'experience counterexample content is immutable'); END;
      CREATE TRIGGER experience_counterexamples_no_delete
      BEFORE DELETE ON experience_counterexamples
      BEGIN SELECT RAISE(ABORT, 'experience counterexamples are append-only'); END;
      CREATE TRIGGER experience_usage_evaluations_no_update
      BEFORE UPDATE ON experience_usage_evaluations
      BEGIN SELECT RAISE(ABORT, 'experience usage evaluations are append-only'); END;
      CREATE TRIGGER experience_usage_evaluations_no_delete
      BEFORE DELETE ON experience_usage_evaluations
      BEGIN SELECT RAISE(ABORT, 'experience usage evaluations are append-only'); END;
    `,
  },
  {
    version: 6,
    name: "product_profile_and_generic_creator_identity",
    sql: `
      CREATE TABLE product_profiles (
        profile_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        locale TEXT NOT NULL,
        timezone TEXT NOT NULL,
        onboarding_status TEXT NOT NULL CHECK(onboarding_status IN ('needs_profile','ready')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE product_profile_revisions (
        revision_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES product_profiles(profile_id),
        version INTEGER NOT NULL,
        display_name TEXT NOT NULL,
        locale TEXT NOT NULL,
        timezone TEXT NOT NULL,
        onboarding_status TEXT NOT NULL CHECK(onboarding_status IN ('needs_profile','ready')),
        updated_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(profile_id,version)
      );
      CREATE TRIGGER product_profiles_identity_immutable
      BEFORE UPDATE OF profile_id,actor_id,created_at ON product_profiles
      BEGIN SELECT RAISE(ABORT, 'product profile identity is immutable'); END;
      CREATE TRIGGER product_profile_revisions_no_update
      BEFORE UPDATE ON product_profile_revisions
      BEGIN SELECT RAISE(ABORT, 'product profile revisions are append-only'); END;
      CREATE TRIGGER product_profile_revisions_no_delete
      BEFORE DELETE ON product_profile_revisions
      BEGIN SELECT RAISE(ABORT, 'product profile revisions are append-only'); END;
      INSERT INTO product_profiles(
        profile_id,actor_id,display_name,locale,timezone,onboarding_status,created_at,updated_at
      ) VALUES (
        'primary','local_creator',
        COALESCE((SELECT NULLIF(TRIM(display_name),'') FROM state_subjects WHERE subject_id='creator'),'使用者'),
        'zh-CN','Asia/Shanghai',
        CASE WHEN EXISTS(SELECT 1 FROM state_subjects WHERE subject_id='creator' AND TRIM(display_name)!='') THEN 'ready' ELSE 'needs_profile' END,
        strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
      );
      INSERT INTO product_profile_revisions(
        revision_id,profile_id,version,display_name,locale,timezone,onboarding_status,updated_by,created_at
      ) SELECT 'profile_revision_1',profile_id,1,display_name,locale,timezone,onboarding_status,
        actor_id,created_at FROM product_profiles WHERE profile_id='primary';
      INSERT INTO authority_policies(
        policy_id,principal_id,principal_kind,capability,effect,
        requires_creator_confirmation,rationale,policy_version,status,created_at
      ) VALUES
        ('authority_v2_creator_01','local_creator','creator','goal.own','allow',0,'本地创建者拥有自己的目标。',2,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('authority_v2_creator_02','local_creator','creator','formal_state.confirm','allow',0,'只有本地创建者可以确认或纠正正式状态。',2,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('authority_v2_creator_03','local_creator','creator','execution.approve','allow',0,'只有本地创建者可以批准执行边界。',2,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('authority_v2_creator_04','local_creator','creator','goal.final_accept','allow',0,'只有本地创建者可以最终接受或拒绝目标结果。',2,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('authority_v2_creator_05','local_creator','creator','experience.promote','allow',0,'只有本地创建者可以把候选经验提升为正式经验。',2,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `,
  },
  {
    version: 7,
    name: "record_context_separation",
    sql: `
      CREATE TABLE record_contexts (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        context_kind TEXT NOT NULL CHECK(context_kind IN ('product','development','acceptance','system')),
        visibility TEXT NOT NULL CHECK(visibility IN ('primary','secondary','hidden')),
        source TEXT NOT NULL,
        reason TEXT NOT NULL,
        classified_by TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(entity_type,entity_id)
      );
      CREATE INDEX record_contexts_kind_visibility
        ON record_contexts(context_kind,visibility,updated_at DESC);
      CREATE TABLE record_context_revisions (
        revision_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        context_kind TEXT NOT NULL CHECK(context_kind IN ('product','development','acceptance','system')),
        visibility TEXT NOT NULL CHECK(visibility IN ('primary','secondary','hidden')),
        source TEXT NOT NULL,
        reason TEXT NOT NULL,
        classified_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(entity_type,entity_id,version)
      );
      CREATE TRIGGER record_context_revisions_no_update
      BEFORE UPDATE ON record_context_revisions
      BEGIN SELECT RAISE(ABORT, 'record context revisions are append-only'); END;
      CREATE TRIGGER record_context_revisions_no_delete
      BEFORE DELETE ON record_context_revisions
      BEGIN SELECT RAISE(ABORT, 'record context revisions are append-only'); END;
    `,
  },
  {
    version: 8,
    name: "reminder_automations",
    sql: `
      CREATE TABLE automations (
        automation_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        schedule_kind TEXT NOT NULL CHECK(schedule_kind IN ('once','daily')),
        schedule_json TEXT NOT NULL,
        timezone TEXT NOT NULL,
        next_run_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','paused','completed')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX automations_due ON automations(status,next_run_at);
      CREATE TABLE automation_occurrences (
        occurrence_id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL REFERENCES automations(automation_id),
        scheduled_for TEXT NOT NULL,
        fired_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','acknowledged')),
        acknowledged_at TEXT,
        acknowledged_by TEXT,
        UNIQUE(automation_id,scheduled_for)
      );
      CREATE INDEX automation_occurrences_status ON automation_occurrences(status,fired_at DESC);
      CREATE TABLE automation_event_log (
        automation_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        automation_id TEXT NOT NULL REFERENCES automations(automation_id),
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TRIGGER automation_event_log_no_update
      BEFORE UPDATE ON automation_event_log
      BEGIN SELECT RAISE(ABORT, 'automation event log is append-only'); END;
      CREATE TRIGGER automation_event_log_no_delete
      BEFORE DELETE ON automation_event_log
      BEGIN SELECT RAISE(ABORT, 'automation event log is append-only'); END;
    `,
  },
  {
    version: 9,
    name: "agenthub_material_dialogues",
    sql: `
      CREATE TABLE material_dialogues (
        dialogue_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES interaction_sessions(session_id),
        root_intake_id TEXT NOT NULL UNIQUE REFERENCES intake_events(intake_id),
        current_intake_id TEXT NOT NULL REFERENCES intake_events(intake_id),
        status TEXT NOT NULL CHECK(status IN ('awaiting_answer','understanding_ready','closed','superseded')),
        phase TEXT NOT NULL CHECK(phase IN ('needs_one_answer','understanding_ready','closed')),
        brief_json TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        clarifications_json TEXT NOT NULL,
        current_question_json TEXT,
        asked_question_keys_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX material_dialogues_one_pending_per_session
        ON material_dialogues(session_id) WHERE status='awaiting_answer';
      CREATE INDEX material_dialogues_session_updated
        ON material_dialogues(session_id,updated_at DESC);
      CREATE TABLE material_dialogue_turns (
        turn_id TEXT PRIMARY KEY,
        dialogue_id TEXT NOT NULL REFERENCES material_dialogues(dialogue_id),
        intake_id TEXT NOT NULL UNIQUE REFERENCES intake_events(intake_id),
        turn_index INTEGER NOT NULL,
        turn_kind TEXT NOT NULL CHECK(turn_kind IN ('submission','answer','material_addition')),
        question_key TEXT,
        answer_text TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(dialogue_id,turn_index)
      );
      CREATE TRIGGER material_dialogue_turns_no_update
      BEFORE UPDATE ON material_dialogue_turns
      BEGIN SELECT RAISE(ABORT, 'material dialogue turns are append-only'); END;
      CREATE TRIGGER material_dialogue_turns_no_delete
      BEFORE DELETE ON material_dialogue_turns
      BEGIN SELECT RAISE(ABORT, 'material dialogue turns are append-only'); END;
    `,
  },
]);

function checksum(migration) {
  return createHash("sha256")
    .update(`${migration.version}:${migration.name}:${migration.sql}:${JSON.stringify(AUTHORITY_BASELINE_V1)}`)
    .digest("hex");
}

function seedAuthorityPolicies(db, appliedAt) {
  const insert = db.prepare(`
    INSERT INTO authority_policies(
      policy_id,principal_id,principal_kind,capability,effect,
      requires_creator_confirmation,rationale,policy_version,status,created_at
    ) VALUES (?,?,?,?,?,?,?,?, 'active', ?)
  `);
  for (const [index, policy] of AUTHORITY_BASELINE_V1.entries()) {
    insert.run(
      `authority_v1_${String(index + 1).padStart(2, "0")}`,
      policy.principal_id,
      policy.principal_kind,
      policy.capability,
      policy.effect,
      policy.requires_creator_confirmation ? 1 : 0,
      policy.rationale,
      1,
      appliedAt,
    );
  }
}

export function applyMigrations(db, { appliedAt = new Date().toISOString() } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  for (const migration of MIGRATIONS) {
    const digest = checksum(migration);
    const existing = db.prepare("SELECT checksum FROM schema_migrations WHERE version=?").get(migration.version);
    if (existing) {
      if (existing.checksum !== digest) throw new Error(`migration ${migration.version} checksum mismatch`);
      continue;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      if (migration.version === 1) seedAuthorityPolicies(db, appliedAt);
      db.prepare("INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES (?,?,?,?)")
        .run(migration.version, migration.name, digest, appliedAt);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return db.prepare("SELECT version,name,checksum,applied_at FROM schema_migrations ORDER BY version").all();
}
