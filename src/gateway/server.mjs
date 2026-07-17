import { createServer } from "node:http";
import { appendEvent, canonicalJson, newId, now } from "../core/store.mjs";
import { analyzeIntent } from "../intelligence/intent-router.mjs";
import { classifyOperatingDomain } from "../intelligence/domain-router.mjs";
import { createStateSubject, proposeStateUpdate, decideStateUpdate, getCurrentState, buildStateDecisionCard } from "../state/dynamic-state.mjs";
import { createGoal, proposePlan, decideApproval, decideRun, getPlanHash } from "../core/kernel.mjs";
import { recordMemoryCandidate, addMemoryCounterexample, promoteMemoryCandidate, listMemoryCandidates } from "../memory/promotion.mjs";
import { extractCreatorSignals } from "../intelligence/creator-signal-extractor.mjs";
import { decideIntakeInteraction } from "../intelligence/intake-decision.mjs";
import { composeGroundedAnswer } from "../intelligence/grounded-answer.mjs";
import { buildActionPlanCandidate } from "../intelligence/action-plan-candidate.mjs";
import { analyzeMaterialBundle, containsMaterial, normalizeSubmittedMaterials } from "../intelligence/material-intake.mjs";
import {
  buildMaterialReceipt,
  createMaterialDialogue,
  decideMaterialUnderstanding,
  getPendingMaterialDialogue,
  MATERIAL_STAGE_LABELS,
  recordMaterialAddition,
  recordMaterialAnswer,
  selectNextMaterialQuestion,
} from "../intelligence/material-dialogue.mjs";
import { buildTodayReadModel, getConfirmationReadModel, humanizeStateDecisionCard } from "../product/today-read-model.mjs";
import { COCKPIT_HTML } from "../product/cockpit-html.mjs";
import {
  buildCreatorModelReadModel,
  buildWorkspaceIndexReadModel,
  buildWorkspaceReadModel,
  listJudgmentReadModel,
} from "../product/read-models.mjs";
import { createPlanCandidate, decidePlanCandidate, getCurrentPlanCandidate, revisePlanCandidate } from "../planning/plan-candidates.mjs";
import { configureExecutionBoundary, createExecutionBoundary, decideExecutionBoundary, getExecutionBoundary } from "../planning/execution-boundary.mjs";

import { assessCreatorProject, getCreatorPortfolio, upsertCreatorProjectBaseline } from "../creator/project-priority.mjs";
import { proposeProjectChange, decideProjectChange, listProjectChanges, getProjectCurrentState } from "../creator/project-changes.mjs";
import { getProjectProgressReadModel, proposeProjectProgress } from "../creator/project-progress.mjs";
import { syncCreatorPortfolioIndex, searchKnowledgeIndex, getKnowledgeEntity, getKnowledgeIndexHealth, rebuildKnowledgeIndex } from "../indexing/knowledge-index.mjs";
import { matchCreatorProject } from "../creator/project-match.mjs";
import { buildResumePacket, closeTurn, createContinuationCheckpoint, listProblems, recordProblemCase, listEvolutionCandidates } from "../continuity/continuity.mjs";
import { classifyWorkspace } from "../product/workspace-classifier.mjs";
import { decideWorkspaceAssignment, getWorkspaceAssignmentForIntake, recordWorkspaceAssignment } from "../product/workspace-assignment.mjs";
import { assertAuthority, getAuthorityReadModel } from "../governance/authority.mjs";
import { getProductProfile, updateProductProfile } from "../product/product-profile.mjs";
import { inferIntakeContext, setRecordContext } from "../product/record-context.mjs";
import { enqueueJob, requestCancel, retryJob } from "../runtime/governance.mjs";
import { listAgents } from "../agents/registry.mjs";
import { acknowledgeReminder, createReminderAutomation, listAutomations, setAutomationStatus } from "../automation/reminders.mjs";
import {
  createExperienceCandidate,
  createJudgment,
  decideExperience,
  decideExperienceCounterexample,
  decideJudgment,
  decideOutcome,
  evaluateExperienceUsage,
  getExperience,
  getJudgment,
  getOutcome,
  proposeExperienceVersion,
  recordExperienceCounterexample,
  recordOutcome,
  retireExperience,
  rollbackExperience,
  withdrawExperienceCandidate,
} from "../intelligence/judgment-loop.mjs";
import {
  decideAdvisoryRecommendation,
  getAdvisorySource,
  listAdvisoryRecommendations,
} from "../advisory/external-advice.mjs";
import {
  buildAgentHubSessionReadModel,
  completeAgentHubRequest,
  failAgentHubRequest,
  getOrCreateAgentHubSession,
  reserveAgentHubRequest,
  validateAgentHubMessage,
} from "../interaction/agenthub-contract.mjs";
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  if (!data) return {};
  try { return JSON.parse(data); } catch { throw new Error("invalid JSON body"); }
}

function acceptIntake(db, input) {
  const submittedMaterials = normalizeSubmittedMaterials(input.materials);
  const submittedMessage = typeof input.message === "string" ? input.message.trim() : "";
  const message = submittedMessage || `提交了 ${submittedMaterials.length} 项材料，请先整理、判断并和我确认下一步。`;
  const materialMarkers = submittedMaterials.map((item) => {
    const marker = item.kind === "image" ? "Image" : item.kind === "audio" ? "Audio" : "File";
    return `[${marker} name="${item.name.replaceAll('"', "'")}"]`;
  });
  const analysisMessage = [message, ...materialMarkers, ...submittedMaterials.map((item) => item.text_content).filter(Boolean)].join("\n");
  const intakeId = newId("intake");
  const rawAnalysis = analyzeIntent(analysisMessage);
  const analysis = { ...rawAnalysis, operating_domain: classifyOperatingDomain(rawAnalysis) };
  const materialBrief = containsMaterial(message, submittedMaterials)
    ? analyzeMaterialBundle(message, { observed_at: input.observed_at ?? now(), submitted_materials: submittedMaterials })
    : null;
  const workspaceClassification = classifyWorkspace(analysisMessage, {
    analysis,
    source: input.source ?? "unknown",
  });
  const interaction = decideIntakeInteraction(analysisMessage, analysis);
  const agentHubMaterialFlow = Boolean(input.agenthub_session_id && materialBrief);
  if (agentHubMaterialFlow) {
    const receipt = buildMaterialReceipt(materialBrief);
    const question = selectNextMaterialQuestion({ message, brief: materialBrief });
    interaction.mode = "project_intake";
    interaction.project_brief = materialBrief;
    interaction.material_receipt = receipt;
    interaction.phase = question ? "needs_one_answer" : "understanding_ready";
    interaction.current_question = question;
    interaction.clarifications = [];
    interaction.fulfillment_status = question ? "awaiting_user_input" : "awaiting_creator_confirmation";
    interaction.next_action = question ? "answer_one_question" : "review_understanding";
    interaction.execution_state = { status: "not_started", label: "尚未启动" };
  }
  if (interaction.mode === "direct_answer") {
    const answer = composeGroundedAnswer(db, analysisMessage, { subject_id: input.metadata?.subject_id ?? "creator" });
    interaction.answer = answer;
    interaction.completed = answer.completed;
    interaction.fulfillment_status = answer.completed ? "answered" : "awaiting_user_input";
    if (answer.question) interaction.question = answer.question;
  }
  if (
    !agentHubMaterialFlow &&
    ["action_proposal", "dispatch_request", "project_intake"].includes(interaction.mode) &&
    interaction.fulfillment_status !== "awaiting_user_input"
  ) {
    const projectMatch = matchCreatorProject(analysisMessage, getCreatorPortfolio(db));
    if (projectMatch.status === "blocked") {
      interaction.fulfillment_status = "blocked_by_project_policy";
      interaction.question = "该项目禁止访问。你是否要改为天枢正式允许的项目？";
    } else {
      interaction.plan_candidate = buildActionPlanCandidate(analysisMessage, interaction, { project_match: projectMatch, material_brief: materialBrief });
      if (materialBrief) interaction.project_brief = materialBrief;
      interaction.fulfillment_status = "awaiting_creator_confirmation";
      interaction.next_action = "confirm_plan_candidate";
    }
  }
  if (interaction.mode === "state_candidate") {
    const subjectId = input.metadata?.subject_id ?? "creator";
    const subjectExists = Boolean(db.prepare("SELECT 1 FROM state_subjects WHERE subject_id=?").get(subjectId));
    const extraction = extractCreatorSignals(analysisMessage);
    if (subjectExists && extraction.signals.length) {
      const proposal = proposeStateUpdate(db, subjectId, {
        observed_at: input.observed_at ?? now(),
        source_type: "creator_intake",
        source_ref: intakeId,
        signals: extraction.signals,
        requirements: [],
        candidate_actions: [],
      });
      proposal.decision_card = humanizeStateDecisionCard(proposal.decision_card);
      interaction.fulfillment_status = "awaiting_creator_decision";
      interaction.next_action = "confirm_state_proposal";
      interaction.state_candidate = { status: "proposal_created", subject_id: subjectId, ...proposal, extraction };
    } else {
      const followUp = extraction.questions[0]?.question_text ?? "这条变化会影响哪个项目、决定或时间安排？";
      interaction.fulfillment_status = "awaiting_user_input";
      interaction.question = followUp;
      interaction.next_action = "clarify_state_change";
      interaction.state_candidate = {
        status: subjectExists ? "no_structured_signal" : "state_subject_missing",
        subject_id: subjectId,
        extraction,
      };
    }
  }
  const intakePayload = () => ({ message, metadata: input.metadata ?? {}, materials: submittedMaterials, analysis, interaction });
  db.prepare("INSERT INTO intake_events VALUES (?, ?, ?, 'accepted', ?)").run(intakeId, input.source ?? "unknown", canonicalJson(intakePayload()), now());
  setRecordContext(db, {
    entity_type: "intake",
    entity_id: intakeId,
    context_kind: inferIntakeContext(input),
    source: input.metadata?.context_kind ? "explicit_input_metadata" : "source_default",
    reason: input.metadata?.context_reason ?? "",
  });
  const workspaceAssignment = recordWorkspaceAssignment(db, intakeId, workspaceClassification);
  if (agentHubMaterialFlow) {
    const dialogue = createMaterialDialogue(db, {
      session_id: input.agenthub_session_id,
      intake_id: intakeId,
      message,
      brief: materialBrief,
      receipt: interaction.material_receipt,
    });
    interaction.material_dialogue_id = dialogue.dialogue_id;
    interaction.phase = dialogue.phase;
    interaction.current_question = dialogue.current_question;
    interaction.clarifications = dialogue.clarifications;
  }
  if (interaction.plan_candidate) {
    interaction.plan_candidate = createPlanCandidate(db, intakeId, interaction.plan_candidate);
  }
  if (agentHubMaterialFlow || interaction.plan_candidate) {
    db.prepare("UPDATE intake_events SET payload_json=? WHERE intake_id=?").run(canonicalJson(intakePayload()), intakeId);
  }
  appendEvent(db, "intake", intakeId, "intake.accepted", { source: input.source ?? "unknown", interaction_mode: interaction.mode, workspace: workspaceAssignment.effective_workspace, material_count: materialBrief?.materials.length ?? 0 });
  return {
    intake_id: intakeId,
    status: "accepted",
    routed_to: "tianshu-orchestrator",
    state_authority: "sqlite",
    next: ["needs_creator_confirmation", "unresolved"].includes(workspaceAssignment.status)
      ? "confirm_workspace"
      : interaction.next_action ?? interaction.mode,
    workspace_assignment: workspaceAssignment,
    interaction,
    analysis,
    materials: (materialBrief?.materials ?? submittedMaterials).map(({ text_content, content_data_url, ...item }) => item),
  };
}

function mergeMaterialDialogueBrief(dialogue, message, submittedMaterials, observedAt) {
  if (!containsMaterial(message, submittedMaterials)) return dialogue.brief;
  const addition = analyzeMaterialBundle(message || "补充材料", {
    observed_at: observedAt ?? now(),
    submitted_materials: submittedMaterials,
  });
  const materials = [...dialogue.brief.materials, ...addition.materials].map((item, index) => ({
    ...item,
    material_id: `material_${index + 1}`,
  }));
  return {
    ...dialogue.brief,
    materials,
    facts: [
      ...(dialogue.brief.facts ?? []).filter((item) => !/^收到 \d+ 项素材$/u.test(item.claim ?? "")),
      { claim: `收到 ${materials.length} 项素材`, evidence: materials.map((item) => item.material_id) },
      ...(addition.facts ?? []).filter((item) => !/^收到 \d+ 项素材$/u.test(item.claim ?? "")),
    ],
    requested_outcomes: [...new Set([...(dialogue.brief.requested_outcomes ?? []), ...(addition.requested_outcomes ?? [])])],
    prohibited_actions: [...new Set([...(dialogue.brief.prohibited_actions ?? []), ...(addition.prohibited_actions ?? [])])],
    unverified_claims: [...(dialogue.brief.unverified_claims ?? []), ...(addition.unverified_claims ?? [])],
    uncertainties: [...(dialogue.brief.uncertainties ?? []), ...(addition.uncertainties ?? [])],
  };
}

function acceptMaterialDialogueTurn(db, input, dialogue) {
  const submittedMaterials = normalizeSubmittedMaterials(input.materials);
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const isMaterialAddition = containsMaterial(message, submittedMaterials);
  const rootRow = db.prepare("SELECT payload_json FROM intake_events WHERE intake_id=?").get(dialogue.root_intake_id);
  const rootPayload = rootRow?.payload_json ? JSON.parse(rootRow.payload_json) : {};
  const rootMessage = String(rootPayload.message ?? "");
  const brief = mergeMaterialDialogueBrief(dialogue, message, submittedMaterials, input.observed_at);
  const analysisMessage = [
    rootMessage,
    ...dialogue.clarifications.map((item) => item.answer),
    message,
  ].filter(Boolean).join("\n");
  const intakeId = newId("intake");
  const rawAnalysis = analyzeIntent(analysisMessage);
  const analysis = { ...rawAnalysis, operating_domain: classifyOperatingDomain(rawAnalysis) };
  const workspaceClassification = classifyWorkspace(analysisMessage, {
    analysis,
    source: input.source ?? "agenthub",
  });
  const interaction = {
    mode: "material_clarification",
    completed: false,
    project_brief: brief,
    material_receipt: buildMaterialReceipt(brief),
    execution_state: { status: "not_started", label: "尚未启动" },
  };
  const intakePayload = () => ({
    message,
    metadata: input.metadata ?? {},
    materials: submittedMaterials,
    analysis,
    interaction,
  });
  db.prepare("INSERT INTO intake_events VALUES (?, ?, ?, 'accepted', ?)").run(
    intakeId,
    input.source ?? "agenthub",
    canonicalJson(intakePayload()),
    now(),
  );
  setRecordContext(db, {
    entity_type: "intake",
    entity_id: intakeId,
    context_kind: inferIntakeContext(input),
    source: input.metadata?.context_kind ? "explicit_input_metadata" : "source_default",
    reason: input.metadata?.context_reason ?? "",
  });
  const workspaceAssignment = recordWorkspaceAssignment(db, intakeId, workspaceClassification);
  const updatedDialogue = isMaterialAddition
    ? recordMaterialAddition(db, dialogue, { intake_id: intakeId, brief })
    : recordMaterialAnswer(db, dialogue, { intake_id: intakeId, answer: message, root_message: rootMessage, brief });
  interaction.material_dialogue_id = updatedDialogue.dialogue_id;
  interaction.phase = updatedDialogue.phase;
  interaction.current_question = updatedDialogue.current_question;
  interaction.clarifications = updatedDialogue.clarifications;
  interaction.fulfillment_status = updatedDialogue.status === "awaiting_answer"
    ? "awaiting_user_input"
    : "awaiting_creator_confirmation";
  interaction.next_action = updatedDialogue.status === "awaiting_answer"
    ? "answer_one_question"
    : "review_understanding";

  db.prepare("UPDATE intake_events SET payload_json=? WHERE intake_id=?").run(canonicalJson(intakePayload()), intakeId);
  appendEvent(db, "intake", intakeId, "intake.material_dialogue_updated", {
    dialogue_id: updatedDialogue.dialogue_id,
    phase: updatedDialogue.phase,
    material_count: brief.materials.length,
    execution_started: false,
  });
  return {
    intake_id: intakeId,
    status: "accepted",
    routed_to: "tianshu-orchestrator",
    state_authority: "sqlite",
    next: interaction.next_action,
    workspace_assignment: workspaceAssignment,
    interaction,
    analysis,
    materials: brief.materials.map(({ text_content, content_data_url, ...item }) => item),
  };
}

function buildAgentHubAssistantMessage(intake) {
  const interaction = intake.interaction ?? {};
  const answer = interaction.answer ?? {};
  const brief = interaction.project_brief ?? null;
  const waitingForMaterialAnswer = Boolean(brief && interaction.phase === "needs_one_answer");
  const materialDialogue = Boolean(interaction.material_dialogue_id);
  const confirmationId = materialDialogue ? null : (
    interaction.plan_candidate?.candidate_id ??
      interaction.state_candidate?.cycle_id ??
      intake.workspace_assignment?.assignment_id ??
      null
  );
  const requiresConfirmation = Boolean(confirmationId) || [
    "awaiting_creator_confirmation",
    "awaiting_creator_decision",
    "awaiting_creator_feedback",
  ].includes(interaction.fulfillment_status);
  const fallback = requiresConfirmation
    ? "我已经整理出一项需要你确认的候选，请在天枢工作台核对后再决定。"
    : "我已经接收并整理了这条信息。";
  const materialSummary = brief
    ? [
        `已完整登记 ${brief.materials.length} 项材料，并归入“${brief.title}”。`,
        brief.project_proposal?.positioning ? `项目定位：${brief.project_proposal.positioning}。` : null,
        brief.requested_outcomes?.length ? `首轮目标：${brief.requested_outcomes.join("、")}。` : null,
        brief.prohibited_actions?.length ? `明确边界：不授权${brief.prohibited_actions.join("、")}。` : null,
        "当前只形成项目对齐候选，尚未启动 Agent。",
      ].filter(Boolean)
    : [];
  if (waitingForMaterialAnswer) {
    const receipt = interaction.material_receipt ?? buildMaterialReceipt(brief);
    const question = interaction.current_question;
    return {
      text: [
        `已完整登记 ${receipt.registered_count} 项材料，数量、顺序、来源和原始内容都已保留。`,
        "我先不派 Agent，也不开始执行。在形成当前理解前，只确认一个关键问题：",
        question?.text,
      ].filter(Boolean).join("\n"),
      fulfillment_status: "awaiting_user_input",
      next_action: "answer_one_question",
      requires_creator_confirmation: false,
      confirmation: null,
      card: {
        kind: "materials_received",
        display_title: MATERIAL_STAGE_LABELS.materials_received,
        stage_label: MATERIAL_STAGE_LABELS.needs_one_answer,
        title: brief.title,
        summary: brief.summary,
        material_count: receipt.registered_count,
        receipt,
        question,
        execution_state: interaction.execution_state,
      },
    };
  }
  if (brief && interaction.phase === "understanding_ready") {
    return {
      text: [
        `已完整登记 ${brief.materials.length} 项材料。`,
        `我目前理解这是“${brief.title}”相关需求。`,
        interaction.clarifications?.length ? `你补充说明：${interaction.clarifications.at(-1).answer}` : null,
        brief.project_proposal?.positioning ? `当前定位：${brief.project_proposal.positioning}。` : null,
        brief.requested_outcomes?.length ? `你希望先得到：${brief.requested_outcomes.join("、")}。` : null,
        brief.prohibited_actions?.length ? `明确不能做：${brief.prohibited_actions.join("、")}。` : null,
        "现在仍未启动 Agent 或执行任何动作，请先核对我的理解。",
      ].filter(Boolean).join("\n"),
      fulfillment_status: interaction.fulfillment_status,
      next_action: interaction.next_action,
      requires_creator_confirmation: true,
      confirmation: null,
      card: {
        kind: "understanding_summary",
        display_title: MATERIAL_STAGE_LABELS.understanding_ready,
        title: brief.title,
        summary: brief.summary,
        material_count: brief.materials.length,
        material_dialogue_id: interaction.material_dialogue_id,
        project: brief.project_proposal,
        requested_outcomes: brief.requested_outcomes,
        prohibited_actions: brief.prohibited_actions,
        clarifications: interaction.clarifications ?? [],
        facts: brief.facts,
        inferences: brief.inferences,
        uncertainties: brief.uncertainties,
        research_preview: brief.research_plan,
        execution_state: interaction.execution_state,
      },
    };
  }
  const parts = materialSummary.length ? materialSummary : [answer.judgment, answer.rationale, answer.next_action].filter(Boolean);
  return {
    text: parts.length ? parts.join("\n") : fallback,
    fulfillment_status: interaction.fulfillment_status ?? "accepted",
    next_action: answer.next_action ?? interaction.next_action ?? intake.next ?? null,
    requires_creator_confirmation: requiresConfirmation,
    confirmation: confirmationId ? {
      confirmation_id: confirmationId,
      cockpit_path: `/agenthub?confirmation=${encodeURIComponent(confirmationId)}`,
    } : null,
    card: brief ? {
      kind: "project_alignment",
      title: brief.title,
      summary: brief.summary,
      material_count: brief.materials.length,
      project: brief.project_proposal,
      requested_outcomes: brief.requested_outcomes,
      prohibited_actions: brief.prohibited_actions,
      uncertainties: brief.uncertainties,
      recommendation: brief.judgment?.recommendation ?? null,
    } : null,
  };
}

export function createGateway({ db, host = "127.0.0.1", port = 0, health = null } = {}) {
  if (!db) throw new Error("gateway requires SQLite db");
  const eventStreams = new Set();
  function openProjectEventStream(req, res, url) {
    let cursor = Number(req.headers["last-event-id"] ?? url.searchParams.get("after_id") ?? 0) || 0;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "access-control-allow-origin": "*"
    });
    res.write("retry: 3000\n\n");
    const flush = () => {
      for (const item of db.prepare("SELECT event_id,entity_type,entity_id,event_type,payload_json,created_at FROM events WHERE event_id>? ORDER BY event_id ASC LIMIT 100").all(cursor)) {
        cursor = Number(item.event_id);
        const eventName = item.entity_type === "project_change" ? "project-change" : "state-event";
        res.write("id: " + cursor + "\n");
        res.write("event: " + eventName + "\n");
        res.write("data: " + JSON.stringify({ event_id: cursor, entity_type: item.entity_type, entity_id: item.entity_id, event_type: item.event_type, payload: JSON.parse(item.payload_json), created_at: item.created_at }) + "\n\n");
      }
    };
    flush();
    const timer = setInterval(() => { try { flush(); res.write(": heartbeat\n\n"); } catch {} }, 1000);
    timer.unref?.();
    const stream = { res, timer };
    eventStreams.add(stream);
    req.on("close", () => { clearInterval(timer); eventStreams.delete(stream); });
  }
  const server = createServer(async (req, res) => {
    try {
      const streamUrl = new URL(req.url, "http://localhost");
      if (req.method === "GET" && streamUrl.pathname === "/v1/events/stream") {
        openProjectEventStream(req, res, streamUrl);
        return;
      }
      if (req.method === "GET" && req.url === "/health") {
        return json(res, 200, { status: "ok", control_plane: "tianshu-orchestrator", state_store: "sqlite", ...(health ? health() : {}) });
      }
      if (req.method === "GET" && req.url === "/v1/governance/authority") {
        return json(res, 200, getAuthorityReadModel(db));
      }
      if (req.method === "GET" && req.url === "/v1/profile") {
        return json(res, 200, { profile: getProductProfile(db), state_authority: "sqlite" });
      }
      if (req.method === "PUT" && req.url === "/v1/profile") {
        return json(res, 200, { profile: updateProductProfile(db, await body(req)), state_authority: "sqlite" });
      }
      if (req.method === "GET" && req.url === "/v1/overview") {
        return json(res, 200, {
          control_plane: "tianshu-orchestrator",
          state_store: "sqlite",
          counts: {
            intakes: db.prepare("SELECT COUNT(*) AS count FROM intake_events").get().count,
            goals: db.prepare("SELECT COUNT(*) AS count FROM goals").get().count,
            active_states: db.prepare("SELECT COUNT(*) AS count FROM state_subjects WHERE current_snapshot_id IS NOT NULL").get().count,
            agent_runs: db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get().count,
          },
          subjects: db.prepare("SELECT subject_id, display_name, current_snapshot_id, updated_at FROM state_subjects ORDER BY updated_at DESC").all(),
        });
      }
      if (req.method === "GET" && req.url === "/v1/agents") {
        return json(res, 200, {
          items: listAgents(db).map(({ command, args, ...agent }) => agent),
          state_authority: "sqlite",
        });
      }
      if (req.method === "GET" && req.url === "/v1/today") {
        return json(res, 200, buildTodayReadModel(db));
      }
      if (req.method === "GET" && streamUrl.pathname === "/v1/automations") {
        return json(res, 200, { items: listAutomations(db, { status: streamUrl.searchParams.get("status") }), state_authority: "sqlite" });
      }
      if (req.method === "POST" && streamUrl.pathname === "/v1/automations") {
        return json(res, 201, { automation: createReminderAutomation(db, await body(req)), state_authority: "sqlite" });
      }
      const automationStatusMatch = streamUrl.pathname.match(/^\/v1\/automations\/([^/]+)\/status$/);
      if (req.method === "POST" && automationStatusMatch) {
        return json(res, 200, { automation: setAutomationStatus(db, decodeURIComponent(automationStatusMatch[1]), await body(req)), state_authority: "sqlite" });
      }
      const reminderAcknowledgeMatch = streamUrl.pathname.match(/^\/v1\/automation-occurrences\/([^/]+)\/acknowledge$/);
      if (req.method === "POST" && reminderAcknowledgeMatch) {
        return json(res, 200, { occurrence: acknowledgeReminder(db, decodeURIComponent(reminderAcknowledgeMatch[1]), await body(req)), state_authority: "sqlite" });
      }
      if (req.method === "GET" && streamUrl.pathname === "/v1/workspaces") {
        return json(res, 200, buildWorkspaceIndexReadModel(db));
      }
      if (req.method === "GET" && streamUrl.pathname === "/v1/jobs") {
        return json(res, 200, {
          items: buildWorkspaceReadModel(db, "activity", {
            limit: streamUrl.searchParams.get("limit") ?? undefined,
          }).jobs,
          state_authority: "sqlite",
          decision_authority: getProductProfile(db).actor_id,
        });
      }
      const jobCancelMatch = streamUrl.pathname.match(/^\/v1\/jobs\/([^/]+)\/cancel$/);
      if (req.method === "POST" && jobCancelMatch) {
        const input = await body(req);
        return json(res, 200, {
          job_id: jobCancelMatch[1],
          status: requestCancel(db, jobCancelMatch[1], input.decided_by ?? null),
          state_authority: "sqlite",
        });
      }
      const jobRetryMatch = streamUrl.pathname.match(/^\/v1\/jobs\/([^/]+)\/retry$/);
      if (req.method === "POST" && jobRetryMatch) {
        const input = await body(req);
        return json(res, 200, {
          job: retryJob(db, jobRetryMatch[1], input.decided_by ?? null),
          state_authority: "sqlite",
        });
      }
      const taskStartMatch = streamUrl.pathname.match(/^\/v1\/tasks\/([^/]+)\/start$/);
      if (req.method === "POST" && taskStartMatch) {
        const input = await body(req);
        const actor = assertAuthority(db, input.decided_by ?? null, "execution.approve");
        const task = db.prepare(`
          SELECT t.task_id,t.status,p.plan_id,g.goal_id,b.status boundary_status,b.boundary_json
          FROM tasks t
          JOIN plans p ON p.plan_id=t.plan_id
          JOIN goals g ON g.goal_id=p.goal_id
          JOIN execution_boundaries b ON b.plan_id=p.plan_id
          WHERE t.task_id=?
        `).get(taskStartMatch[1]);
        if (!task) return json(res, 404, { error: "task not found" });
        if (task.status !== "approved" || task.boundary_status !== "approved") {
          return json(res, 409, { error: "task and execution boundary must be approved before start" });
        }
        const existing = db.prepare(`
          SELECT * FROM jobs
          WHERE json_extract(payload_json,'$.type')='managed_execution'
            AND json_extract(payload_json,'$.task_id')=?
          ORDER BY created_at DESC LIMIT 1
        `).get(task.task_id);
        if (existing) return json(res, 200, { job_id: existing.job_id, task_id: task.task_id, status: existing.status, replayed: true, state_authority: "sqlite" });
        const boundary = JSON.parse(task.boundary_json);
        const jobId = enqueueJob(db, {
          projectId: "tianshu",
          payload: { type: "managed_execution", task_id: task.task_id, started_by: actor },
          maxAttempts: boundary.max_attempts,
        });
        return json(res, 202, { job_id: jobId, task_id: task.task_id, status: "queued", replayed: false, state_authority: "sqlite" });
      }
      const workspaceModelMatch = streamUrl.pathname.match(/^\/v1\/workspaces\/([^/]+)$/);
      if (req.method === "GET" && workspaceModelMatch) {
        try {
          return json(res, 200, buildWorkspaceReadModel(
            db,
            decodeURIComponent(workspaceModelMatch[1]),
            { limit: streamUrl.searchParams.get("limit") },
          ));
        } catch (error) {
          if (error.message.startsWith("unknown workspace:")) {
            return json(res, 404, { error: error.message });
          }
          throw error;
        }
      }
      if (req.method === "GET" && streamUrl.pathname === "/v1/creator-model") {
        return json(res, 200, buildCreatorModelReadModel(db));
      }
      if (req.method === "GET" && req.url === "/v1/confirmations") {
        return json(res, 200, { items: getConfirmationReadModel(db), state_authority: "sqlite" });
      }
      if (req.method === "GET" && streamUrl.pathname === "/v1/advisory/recommendations") {
        return json(res, 200, {
          items: listAdvisoryRecommendations(db, { status: streamUrl.searchParams.get("status") ?? undefined }),
          state_authority: "sqlite",
          decision_authority: getProductProfile(db).actor_id,
        });
      }
      const advisorySourceMatch = streamUrl.pathname.match(/^\/v1\/advisory\/sources\/([^/]+)$/);
      if (req.method === "GET" && advisorySourceMatch) {
        const source = getAdvisorySource(db, decodeURIComponent(advisorySourceMatch[1]));
        return source
          ? json(res, 200, { source, state_authority: "sqlite" })
          : json(res, 404, { error: "advisory source not found" });
      }
      const advisoryDecisionMatch = streamUrl.pathname.match(/^\/v1\/advisory\/recommendations\/([^/]+)\/decision$/);
      if (req.method === "POST" && advisoryDecisionMatch) {
        return json(res, 200, {
          recommendation: decideAdvisoryRecommendation(db, decodeURIComponent(advisoryDecisionMatch[1]), await body(req)),
          state_authority: "sqlite",
          decision_authority: getProductProfile(db).actor_id,
        });
      }
      const continuityUrl = new URL(req.url, "http://localhost");
      if (req.method === "GET" && continuityUrl.pathname === "/v1/continuity/resume") {
        return json(res, 200, buildResumePacket(db, continuityUrl.searchParams.get("scope") ?? "tianshu"));
      }
      if (req.method === "POST" && req.url === "/v1/continuity/checkpoints") {
        return json(res, 201, { checkpoint: createContinuationCheckpoint(db, await body(req)), state_authority: "sqlite" });
      }
      if (req.method === "POST" && req.url === "/v1/continuity/close-turn") {
        return json(res, 201, closeTurn(db, await body(req)));
      }
      if (req.method === "GET" && continuityUrl.pathname === "/v1/continuity/problems") {
        return json(res, 200, { items: listProblems(db, { status: continuityUrl.searchParams.get("status") ?? undefined }), state_authority: "sqlite" });
      }
      if (req.method === "POST" && req.url === "/v1/continuity/problems") {
        return json(res, 201, { problem: recordProblemCase(db, await body(req)), state_authority: "sqlite" });
      }
      if (req.method === "GET" && continuityUrl.pathname === "/v1/continuity/evolution-candidates") {
        return json(res, 200, { items: listEvolutionCandidates(db, continuityUrl.searchParams.get("kind")), state_authority: "sqlite" });
      }      if (req.method === "GET" && req.url === "/v1/decisions") {
        return json(res, 200, { items: db.prepare(`SELECT d.decision_id, d.run_id, d.decision, d.reason, d.decided_by, d.created_at, v.passed, v.report_json, v.verifier FROM decisions d LEFT JOIN verifications v ON v.run_id=d.run_id ORDER BY d.created_at DESC`).all().map((row) => ({ ...row, report: row.report_json ? JSON.parse(row.report_json) : null })) });
      }
      if (req.method === "POST" && req.url === "/v1/creator/project-match") {
        const input = await body(req);
        return json(res, 200, { ...matchCreatorProject(input.message, getCreatorPortfolio(db)), state_authority: "sqlite" });
      }
      if (req.method === "GET" && continuityUrl.pathname === "/v1/index/health") {
        return json(res, 200, { ...getKnowledgeIndexHealth(db), state_authority: "sqlite" });
      }
      if (req.method === "GET" && continuityUrl.pathname === "/v1/index/search") {
        return json(res, 200, { items: searchKnowledgeIndex(db, continuityUrl.searchParams.get("q") ?? ""), state_authority: "sqlite" });
      }
      const indexEntityMatch = continuityUrl.pathname.match(/^\/v1\/index\/entities\/([^/]+)$/);
      if (indexEntityMatch && req.method === "GET") {
        const entity = getKnowledgeEntity(db, indexEntityMatch[1]); return entity ? json(res, 200, { entity, state_authority: "sqlite" }) : json(res, 404, { error: "index entity not found" });
      }
      if (req.method === "POST" && continuityUrl.pathname === "/v1/index/rebuild") {
        return json(res, 200, { health: rebuildKnowledgeIndex(db), state_authority: "sqlite" });
      }      if (req.method === "GET" && req.url === "/v1/creator/portfolio") {
        return json(res, 200, { state_authority: "sqlite", items: getCreatorPortfolio(db) });
      }
      if (req.method === "POST" && req.url === "/v1/creator/portfolio/import") {
        const input = await body(req);
        const project_keys = upsertCreatorProjectBaseline(db, input); syncCreatorPortfolioIndex(db); return json(res, 201, { project_keys, state_authority: "sqlite" });
      }
      if (req.method === "GET" && continuityUrl.pathname === "/v1/project-changes") {
        return json(res, 200, { items: listProjectChanges(db, { project_key: continuityUrl.searchParams.get("project_key"), status: continuityUrl.searchParams.get("status"), after_id: continuityUrl.searchParams.get("after_id") }), state_authority: "sqlite" });
      }
      const projectChangeCreateMatch = continuityUrl.pathname.match(/^\/v1\/creator\/projects\/([^/]+)\/changes$/);
      if (projectChangeCreateMatch && req.method === "POST") {
        return json(res, 201, { change: proposeProjectChange(db, decodeURIComponent(projectChangeCreateMatch[1]), await body(req)), state_authority: "sqlite" });
      }
      const projectProgressMatch = continuityUrl.pathname.match(/^\/v1\/creator\/projects\/([^/]+)\/progress$/);
      if (projectProgressMatch && req.method === "POST") {
        return json(res, 201, { progress: proposeProjectProgress(db, decodeURIComponent(projectProgressMatch[1]), await body(req)), state_authority: "sqlite", requires_creator_confirmation: true });
      }
      if (projectProgressMatch && req.method === "GET") {
        return json(res, 200, { project_key: decodeURIComponent(projectProgressMatch[1]), progress: getProjectProgressReadModel(db, decodeURIComponent(projectProgressMatch[1])), state_authority: "sqlite" });
      }
      const projectStateMatch = continuityUrl.pathname.match(/^\/v1\/creator\/projects\/([^/]+)\/state$/);
      if (projectStateMatch && req.method === "GET") {
        return json(res, 200, { project_key: decodeURIComponent(projectStateMatch[1]), state: getProjectCurrentState(db, decodeURIComponent(projectStateMatch[1])), state_authority: "sqlite" });
      }
      const projectChangeDecisionMatch = continuityUrl.pathname.match(/^\/v1\/project-changes\/([^/]+)\/decision$/);
      if (projectChangeDecisionMatch && req.method === "POST") {
        return json(res, 200, { change: decideProjectChange(db, projectChangeDecisionMatch[1], await body(req)), state_authority: "sqlite" });
      }
      const creatorAssessmentMatch = req.url.match(/^\/v1\/creator\/projects\/([^/]+)\/assessments$/);
      if (creatorAssessmentMatch && req.method === "POST") {
        const input = await body(req);
        return json(res, 201, { ...assessCreatorProject(db, creatorAssessmentMatch[1], input), state_authority: "sqlite" });
      }
      const planRevisionMatch = req.url.match(/^\/v1\/plan-candidates\/([^/]+)\/revise$/);
      if (planRevisionMatch && req.method === "POST") {
        const input = await body(req);
        return json(res, 201, { candidate: revisePlanCandidate(db, planRevisionMatch[1], input.revision_note), state_authority: "sqlite" });
      }
      const workspaceReadMatch = req.url.match(/^\/v1\/intakes\/([^/]+)\/workspace$/);
      if (workspaceReadMatch && req.method === "GET") {
        const assignment = getWorkspaceAssignmentForIntake(db, workspaceReadMatch[1]);
        return assignment
          ? json(res, 200, { assignment, state_authority: "sqlite" })
          : json(res, 404, { error: "workspace assignment not found" });
      }
      const workspaceDecisionMatch = req.url.match(/^\/v1\/intakes\/([^/]+)\/workspace-decision$/);
      if (workspaceDecisionMatch && req.method === "POST") {
        return json(res, 200, {
          assignment: decideWorkspaceAssignment(db, workspaceDecisionMatch[1], await body(req)),
          state_authority: "sqlite",
        });
      }
      if (req.method === "POST" && req.url === "/v1/judgments") {
        const input = await body(req);
        return json(res, 201, {
          judgment: createJudgment(db, input),
          next: "await_creator_feedback",
          state_authority: "sqlite",
        });
      }
      if (req.method === "GET" && streamUrl.pathname === "/v1/judgments") {
        return json(res, 200, listJudgmentReadModel(db, {
          workspace: streamUrl.searchParams.get("workspace") ?? undefined,
          status: streamUrl.searchParams.get("status") ?? undefined,
          limit: streamUrl.searchParams.get("limit") ?? undefined,
        }));
      }
      const judgmentReadMatch = req.url.match(/^\/v1\/judgments\/([^/]+)$/);
      if (judgmentReadMatch && req.method === "GET") {
        const judgment = getJudgment(db, judgmentReadMatch[1]);
        return judgment
          ? json(res, 200, { judgment, state_authority: "sqlite" })
          : json(res, 404, { error: "judgment not found" });
      }
      const judgmentFeedbackMatch = req.url.match(/^\/v1\/judgments\/([^/]+)\/feedback$/);
      if (judgmentFeedbackMatch && req.method === "POST") {
        return json(res, 200, {
          judgment: decideJudgment(db, judgmentFeedbackMatch[1], await body(req)),
          state_authority: "sqlite",
        });
      }
      const judgmentOutcomeMatch = req.url.match(/^\/v1\/judgments\/([^/]+)\/outcomes$/);
      if (judgmentOutcomeMatch && req.method === "POST") {
        return json(res, 201, {
          outcome: recordOutcome(db, judgmentOutcomeMatch[1], await body(req)),
          next: "await_creator_outcome_confirmation",
          state_authority: "sqlite",
        });
      }
      const outcomeReadMatch = req.url.match(/^\/v1\/outcomes\/([^/]+)$/);
      if (outcomeReadMatch && req.method === "GET") {
        const outcome = getOutcome(db, outcomeReadMatch[1]);
        return outcome
          ? json(res, 200, { outcome, state_authority: "sqlite" })
          : json(res, 404, { error: "outcome not found" });
      }
      const outcomeDecisionMatch = req.url.match(/^\/v1\/outcomes\/([^/]+)\/decision$/);
      if (outcomeDecisionMatch && req.method === "POST") {
        return json(res, 200, {
          outcome: decideOutcome(db, outcomeDecisionMatch[1], await body(req)),
          state_authority: "sqlite",
        });
      }
      const outcomeExperienceMatch = req.url.match(/^\/v1\/outcomes\/([^/]+)\/experience-candidates$/);
      if (outcomeExperienceMatch && req.method === "POST") {
        const experience = createExperienceCandidate(db, outcomeExperienceMatch[1], await body(req));
        return json(res, 201, {
          experience,
          next: "await_creator_experience_decision",
          state_authority: "sqlite",
        });
      }
      const experienceReadMatch = req.url.match(/^\/v1\/experiences\/([^/]+)$/);
      if (experienceReadMatch && req.method === "GET") {
        const experience = getExperience(db, experienceReadMatch[1]);
        return experience
          ? json(res, 200, { experience, state_authority: "sqlite" })
          : json(res, 404, { error: "experience not found" });
      }
      const experienceDecisionMatch = req.url.match(/^\/v1\/experiences\/([^/]+)\/decision$/);
      if (experienceDecisionMatch && req.method === "POST") {
        return json(res, 200, {
          experience: decideExperience(db, experienceDecisionMatch[1], await body(req)),
          state_authority: "sqlite",
        });
      }
      const experienceVersionMatch = req.url.match(/^\/v1\/experiences\/([^/]+)\/versions$/);
      if (experienceVersionMatch && req.method === "POST") {
        return json(res, 201, {
          experience: proposeExperienceVersion(db, experienceVersionMatch[1], await body(req)),
          next: "await_creator_experience_decision",
          state_authority: "sqlite",
        });
      }
      const experienceWithdrawalMatch = req.url.match(/^\/v1\/experiences\/([^/]+)\/candidate-withdrawal$/);
      if (experienceWithdrawalMatch && req.method === "POST") {
        return json(res, 200, {
          experience: withdrawExperienceCandidate(db, experienceWithdrawalMatch[1], await body(req)),
          state_authority: "sqlite",
        });
      }
      const experienceRetirementMatch = req.url.match(/^\/v1\/experiences\/([^/]+)\/retirement$/);
      if (experienceRetirementMatch && req.method === "POST") {
        return json(res, 200, {
          experience: retireExperience(db, experienceRetirementMatch[1], await body(req)),
          state_authority: "sqlite",
        });
      }
      const experienceRollbackMatch = req.url.match(/^\/v1\/experiences\/([^/]+)\/rollback$/);
      if (experienceRollbackMatch && req.method === "POST") {
        const input = await body(req);
        return json(res, 200, {
          experience: rollbackExperience(db, experienceRollbackMatch[1], input.target_version_id, input),
          state_authority: "sqlite",
        });
      }
      const experienceCounterexampleMatch = req.url.match(/^\/v1\/experiences\/([^/]+)\/counterexamples$/);
      if (experienceCounterexampleMatch && req.method === "POST") {
        return json(res, 201, {
          counterexample: recordExperienceCounterexample(db, experienceCounterexampleMatch[1], await body(req)),
          next: "await_creator_counterexample_decision",
          state_authority: "sqlite",
        });
      }
      const counterexampleDecisionMatch = req.url.match(/^\/v1\/experience-counterexamples\/([^/]+)\/decision$/);
      if (counterexampleDecisionMatch && req.method === "POST") {
        return json(res, 200, {
          experience: decideExperienceCounterexample(db, counterexampleDecisionMatch[1], await body(req)),
          state_authority: "sqlite",
        });
      }
      const usageEvaluationMatch = req.url.match(/^\/v1\/experience-usages\/([^/]+)\/evaluation$/);
      if (usageEvaluationMatch && req.method === "POST") {
        return json(res, 201, {
          experience: evaluateExperienceUsage(db, usageEvaluationMatch[1], await body(req)),
          state_authority: "sqlite",
        });
      }
      const planDecisionMatch = req.url.match(/^\/v1\/intakes\/([^/]+)\/plan-decision$/);
      const materialUnderstandingDecisionMatch = streamUrl.pathname.match(/^\/v1\/material-dialogues\/([^/]+)\/understanding-decision$/);
      if (materialUnderstandingDecisionMatch && req.method === "POST") {
        const input = await body(req);
        if (!["confirm", "revise", "reject"].includes(input.decision)) return json(res, 400, { error: "invalid understanding decision" });
        const actor = assertAuthority(db, input.decided_by ?? "creator", "formal_state.confirm");
        const dialogue = decideMaterialUnderstanding(db, materialUnderstandingDecisionMatch[1], input.decision);
        let planCandidate = null;
        if (input.decision === "confirm") {
          const root = db.prepare("SELECT payload_json FROM intake_events WHERE intake_id=?").get(dialogue.root_intake_id);
          const rootMessage = root?.payload_json ? JSON.parse(root.payload_json).message ?? "材料调研" : "材料调研";
          planCandidate = createPlanCandidate(db, dialogue.current_intake_id, buildActionPlanCandidate(rootMessage, { mode: "project_intake" }, { material_brief: dialogue.brief }));
        }
        const eventName = { confirm: "confirmed", revise: "revision_requested", reject: "rejected" }[input.decision];
        appendEvent(db, "material_dialogue", dialogue.dialogue_id, `material_dialogue.understanding_${eventName}`, {
          decided_by: actor,
          plan_candidate_id: planCandidate?.candidate_id ?? null,
        });
        return json(res, 200, {
          dialogue,
          plan_candidate: planCandidate,
          execution_started: false,
          state_authority: "sqlite",
        });
      }
      if (planDecisionMatch && req.method === "POST") {
        const input = await body(req);
        if (!["approve", "reject"].includes(input.decision)) return json(res, 400, { error: "invalid plan decision" });
        const actor = assertAuthority(db, input.decided_by ?? "creator", "formal_state.confirm");
        const intake = db.prepare("SELECT * FROM intake_events WHERE intake_id=?").get(planDecisionMatch[1]);
        if (!intake) return json(res, 404, { error: "intake not found" });
        if (db.prepare("SELECT 1 FROM intake_confirmations WHERE intake_id=?").get(intake.intake_id)) return json(res, 409, { error: "intake plan already decided" });
        const payload = JSON.parse(intake.payload_json);
        const candidate = getCurrentPlanCandidate(db, intake.intake_id);
        if (!candidate) return json(res, 400, { error: "intake has no current plan candidate" });
        const stamp = now();
        db.prepare("INSERT INTO intake_confirmations VALUES (?, 'plan', ?, NULL, ?, ?, ?)").run(intake.intake_id, input.decision, actor, stamp, stamp);
        if (input.decision !== "approve") {
          if (input.decision === "reject") decidePlanCandidate(db, candidate.candidate_id, "reject");
          appendEvent(db, "intake", intake.intake_id, `intake.plan_${input.decision}d`, { decided_by: actor });
          return json(res, 200, { intake_id: intake.intake_id, status: "rejected", execution_started: false });
        }
        const contract = {
          objective: candidate.objective,
          completion_criteria: candidate.completion_criteria,
          original_request: payload.message,
          real_goal: candidate.objective,
          success_criteria: candidate.completion_criteria,
          non_goals: candidate.non_goals,
          constraints: [...candidate.scope, "未经用户最终确认不得完成目标"],
          required_evidence: candidate.required_evidence,
          risk_level: candidate.risk_level,
          operating_domain: payload.analysis?.operating_domain ?? "work",
          source: `intake:${intake.intake_id}`,
        };
        const goalId = createGoal(db, contract);
        const specification = { action: candidate.objective, allowed_paths: candidate.execution_boundary.allowed_paths, expected_outputs: candidate.completion_criteria, proposed_steps: candidate.proposed_steps, independent_verifier_required: true };
        const planId = proposePlan(db, goalId, specification, candidate.risk_level);
        decidePlanCandidate(db, candidate.candidate_id, "approve");
        createExecutionBoundary(db, planId);
        const projectProposal = candidate.project_brief?.project_proposal;
        let projectKey = null;
        if (projectProposal?.explicitly_requested) {
          [projectKey] = upsertCreatorProjectBaseline(db, {
            source: {
              kind: "creator_confirmed_project_alignment",
              reference: `intake:${intake.intake_id}`,
              version: String(candidate.version),
              authority: actor,
            },
            projects: [{
              project_key: projectProposal.project_key,
              display_name: projectProposal.display_name,
              lane: projectProposal.lane,
              baseline_priority: projectProposal.baseline_priority,
              execution_policy: projectProposal.execution_policy,
              status: projectProposal.status_after_confirmation,
              evidence: [
                projectProposal.positioning,
                `确认输入包含 ${candidate.project_brief.materials.length} 项材料`,
                ...candidate.project_brief.requested_outcomes.map((item) => `首轮目标：${item}`),
                ...candidate.project_brief.prohibited_actions.map((item) => `禁止：${item}`),
              ],
            }],
          });
          syncCreatorPortfolioIndex(db);
        }
        const entities = { goal_id: goalId, plan_id: planId, task_id: null, project_key: projectKey };
        db.prepare("UPDATE intake_confirmations SET entity_json=?,updated_at=? WHERE intake_id=?").run(canonicalJson(entities), now(), intake.intake_id);
        appendEvent(db, "intake", intake.intake_id, "intake.plan_approved", { ...entities, execution_started: false });
        return json(res, 200, { intake_id: intake.intake_id, status: "prepared_not_approved", ...entities, execution_started: false, execution_approval_required: true, state_authority: "sqlite" });
      }
      const executionBoundaryMatch = req.url.match(/^\/v1\/plans\/([^/]+)\/execution-boundary$/);
      if (executionBoundaryMatch && req.method === "POST") {
        const input = await body(req);
        return json(res, 200, { boundary: configureExecutionBoundary(db, executionBoundaryMatch[1], input), state_authority: "sqlite" });
      }
      const executionDecisionMatch = req.url.match(/^\/v1\/plans\/([^/]+)\/execution-decision$/);
      if (executionDecisionMatch && req.method === "POST") {
        const input = await body(req); if (!["approve","reject"].includes(input.decision)) return json(res,400,{error:"invalid execution decision"});
        const boundary = getExecutionBoundary(db, executionDecisionMatch[1]);
        if (!boundary || boundary.status !== "awaiting_creator_confirmation") return json(res,409,{error:"execution boundary is not awaiting creator confirmation"});
        const approval = decideApproval(db, executionDecisionMatch[1], input.decision === "approve" ? "approved" : "rejected", getPlanHash(db, executionDecisionMatch[1]), input.decided_by ?? "creator");
        decideExecutionBoundary(db, executionDecisionMatch[1], input.decision);
        return json(res,200,{plan_id:executionDecisionMatch[1],status:input.decision === "approve" ? "execution_approved_not_started" : "execution_rejected",task_id:approval.taskId,execution_started:false,state_authority:"sqlite"});
      }      const runDecisionMatch = req.url.match(/^\/v1\/runs\/([^/]+)\/decision$/);
      if (runDecisionMatch && req.method === "POST") {
        const input = await body(req);
        if (!["accept", "reject"].includes(input.decision)) return json(res, 400, { error: "invalid creator decision" });
        const decisionId = decideRun(db, runDecisionMatch[1], input.decision, input.reason ?? "", input.decided_by ?? "creator");
        return json(res, 200, { run_id: runDecisionMatch[1], decision_id: decisionId, status: input.decision === "accept" ? "accepted" : "rejected", state_authority: "sqlite" });
      }      const runMatch = req.url.match(/^\/v1\/runs\/([^/]+)$/);
      if (runMatch && req.method === "GET") {
        const run = db.prepare("SELECT * FROM runs WHERE run_id=?").get(runMatch[1]);
        if (!run) return json(res, 404, { error: "run not found" });
        const verification = db.prepare("SELECT * FROM verifications WHERE run_id=?").get(runMatch[1]);
        const decision = db.prepare("SELECT * FROM decisions WHERE run_id=?").get(runMatch[1]);
        return json(res, 200, { run: { ...run, executor_result: run.executor_result_json ? JSON.parse(run.executor_result_json) : null }, verification: verification ? { ...verification, report: JSON.parse(verification.report_json) } : null, decision: decision ?? null });
      }
      if (req.method === "POST" && req.url === "/v1/analyze") {
        const input = await body(req);
        if (!input.text || typeof input.text !== "string") return json(res, 400, { error: "text is required" });
        const analysis = analyzeIntent(input.text);
        return json(res, 200, { analysis: { ...analysis, operating_domain: classifyOperatingDomain(analysis) }, routed_to: "goal_manager" });
      }
      if (req.method === "POST" && req.url === "/v1/state/subjects") {
        const input = await body(req);
        return json(res, 201, createStateSubject(db, input));
      }
      if (req.method === "POST" && req.url === "/v1/goals") {
        const input = await body(req);
        if (!input.original_request || typeof input.original_request !== "string") return json(res, 400, { error: "original_request is required" });
        const analysis = analyzeIntent(input.original_request);
        const contract = {
          objective: input.real_goal ?? input.original_request,
          completion_criteria: input.success_criteria ?? [],
          original_request: input.original_request,
          real_goal: input.real_goal ?? input.original_request,
          success_criteria: input.success_criteria ?? [],
          non_goals: input.non_goals ?? [],
          constraints: input.constraints ?? [],
          required_evidence: input.required_evidence ?? [],
          risk_level: input.risk_level ?? "L1",
          operating_domain: classifyOperatingDomain(analysis),
          source: input.source ?? "gateway",
        };
        return json(res, 201, { goal_id: createGoal(db, contract), status: "contracted", contract, analysis });
      }
      if (req.method === "POST" && req.url === "/v1/memory/candidates") {
        const input = await body(req);
        return json(res, 201, recordMemoryCandidate(db, input));
      }
      const memoryMatch = req.url.match(/^\/v1\/memory\/([^/]+)(?:\/([^/]+))?$/);
      if (memoryMatch && memoryMatch[2] === "promote" && req.method === "POST") {
        const input = await body(req); return json(res, 200, promoteMemoryCandidate(db, memoryMatch[1], input.promoted_by ?? "creator"));
      }
      if (memoryMatch && memoryMatch[2] === "counterexample" && req.method === "POST") {
        const input = await body(req); addMemoryCounterexample(db, memoryMatch[1], input.counterexample); return json(res, 200, { status: "recorded" });
      }
      if (memoryMatch && !memoryMatch[2] && req.method === "GET") return json(res, 200, { items: listMemoryCandidates(db, memoryMatch[1]) });
      const requestUrl = new URL(req.url, "http://localhost");
      const stateMatch = requestUrl.pathname.match(/^\/v1\/state\/([^/]+)(?:\/([^/]+))?$/);
      if (stateMatch && req.method === "GET" && !stateMatch[2]) {
        const state = getCurrentState(db, stateMatch[1]);
        if (!state) return json(res, 404, { error: "state subject not found" });
        return json(res, 200, state);
      }
      if (stateMatch && stateMatch[2] === "propose" && req.method === "POST") {
        const input = await body(req);
        return json(res, 201, proposeStateUpdate(db, stateMatch[1], input));
      }
      if (stateMatch && stateMatch[2] === "propose-from-text" && req.method === "POST") {
        const input = await body(req);
        if (!input.text || typeof input.text !== "string") return json(res, 400, { error: "text is required" });
        const extracted = extractCreatorSignals(input.text);
        const proposal = proposeStateUpdate(db, stateMatch[1], {
          observed_at: input.observed_at ?? now(),
          source_type: "creator_transcript",
          source_ref: input.source_ref ?? "gateway",
          signals: extracted.signals,
          requirements: input.requirements ?? [],
          next_action: input.next_action ?? (extracted.signals.length ? { title: "确认本轮状态变化", owner: "creator", status: "awaiting_creator_decision" } : null),
        });
        return json(res, 201, { ...proposal, extraction: extracted });
      }
      if (stateMatch && stateMatch[2] === "decision" && req.method === "POST") {
        const input = await body(req);
        return json(res, 200, decideStateUpdate(db, input.cycle_id, input.decision, input));
      }
      if (stateMatch && stateMatch[2] === "card" && req.method === "GET") {
        const cycleId = requestUrl.searchParams.get("cycle_id");
        if (!cycleId) return json(res, 400, { error: "cycle_id is required" });
        return json(res, 200, buildStateDecisionCard(db, cycleId));
      }
      if (req.method === "GET" && ["/", "/agenthub"].includes(streamUrl.pathname)) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(COCKPIT_HTML);
      }
      if (req.method === "GET" && streamUrl.pathname === "/v1/channels/agenthub/today") {
        return json(res, 200, buildTodayReadModel(db));
      }
      const agentHubSessionMatch = streamUrl.pathname.match(/^\/v1\/channels\/agenthub\/sessions\/([^/]+)$/);
      if (req.method === "GET" && agentHubSessionMatch) {
        const sessionModel = buildAgentHubSessionReadModel(db, decodeURIComponent(agentHubSessionMatch[1]));
        return json(res, 200, { ...sessionModel, today: buildTodayReadModel(db) });
      }
      if (req.method === "POST" && streamUrl.pathname === "/v1/channels/agenthub/messages") {
        const input = validateAgentHubMessage(db, await body(req));
        const session = getOrCreateAgentHubSession(db, input);
        const reservation = reserveAgentHubRequest(db, session, input);
        if (reservation.replayed) {
          return json(res, 200, {
            ...reservation.response,
            interaction_contract: {
              ...reservation.response.interaction_contract,
              replayed: true,
            },
          });
        }
        try {
          const materialDialogue = getPendingMaterialDialogue(db, session.session_id);
          const intakeInput = {
            message: input.message,
            materials: input.materials,
            source: "agenthub",
            observed_at: input.observed_at,
            agenthub_session_id: session.session_id,
            metadata: {
              ...input.metadata,
              actor_id: input.actor_id,
              actor_kind: input.actor_kind,
              conversation_id: input.conversation_id,
              message_id: input.message_id,
            },
          };
          const intake = materialDialogue
            ? acceptMaterialDialogueTurn(db, intakeInput, materialDialogue)
            : acceptIntake(db, intakeInput);
          const response = {
            ...intake,
            assistant_message: buildAgentHubAssistantMessage(intake),
            interaction_contract: {
              channel: "agenthub",
              session_id: session.session_id,
              request_id: reservation.request.request_id,
              message_id: input.message_id,
              idempotency_key: input.idempotency_key,
              actor_claim: { actor_id: input.actor_id, actor_kind: input.actor_kind },
              authentication: "trusted_agenthub_boundary_required",
              replayed: false,
              reconnect_route: `/v1/channels/agenthub/sessions/${encodeURIComponent(session.session_id)}`,
              today_route: "/v1/channels/agenthub/today",
              cockpit_route: "/agenthub",
              confirmation_link_template: "/agenthub?confirmation=:confirmation_id",
              agenthub_can_confirm: false,
              agenthub_can_execute: false,
            },
          };
          completeAgentHubRequest(db, reservation.request.request_id, intake.intake_id, response);
          return json(res, 202, response);
        } catch (error) {
          failAgentHubRequest(db, reservation.request.request_id, error);
          throw error;
        }
      }
      if (req.method === "POST" && req.url === "/v1/intake") {
        const input = await body(req);
        const hasMessage = typeof input.message === "string" && input.message.trim().length > 0;
        const hasMaterials = Array.isArray(input.materials) && input.materials.length > 0;
        if (!hasMessage && !hasMaterials) return json(res, 400, { error: "message or materials are required" });
        return json(res, 202, acceptIntake(db, input));
      }
      if (req.method === "POST" && req.url === "/v1/device/events") {
        const input = await body(req);
        if (!input.device_id || !input.event_type) return json(res, 400, { error: "device_id and event_type are required" });
        const message = typeof input.payload?.text === "string" ? input.payload.text : `${input.event_type} from ${input.device_id}`;
        const rawAnalysis = analyzeIntent(message);
        const analysis = { ...rawAnalysis, operating_domain: classifyOperatingDomain(rawAnalysis) };
        const eventId = newId("device_event");
        db.prepare("INSERT INTO intake_events VALUES (?, ?, ?, 'accepted', ?)").run(eventId, `device:${input.device_id}`, canonicalJson({ device_id: input.device_id, event_type: input.event_type, payload: input.payload ?? {}, analysis }), input.observed_at ?? now());
        const workspaceAssignment = recordWorkspaceAssignment(db, eventId, classifyWorkspace(message, {
          analysis,
          source: `device:${input.device_id}`,
        }));
        appendEvent(db, "device_event", eventId, "device_event.accepted", { device_id: input.device_id, event_type: input.event_type });
        return json(res, 202, { event_id: eventId, status: "accepted", routed_to: "tianshu-orchestrator", workspace_assignment: workspaceAssignment, analysis });
      }
      if (req.method === "GET" && req.url === "/v1/intakes") {
        const items = db.prepare(`
          SELECT i.intake_id,i.source,i.payload_json,i.status,i.created_at,
                 w.assignment_id,w.effective_workspace,w.status workspace_status,
                 w.confidence workspace_confidence
          FROM intake_events i
          LEFT JOIN workspace_assignments w ON w.intake_id=i.intake_id
          ORDER BY i.created_at DESC
        `).all().map((row) => {
          const payload = JSON.parse(row.payload_json);
          return {
            intake_id: row.intake_id,
            source: row.source,
            status: row.status,
            created_at: row.created_at,
            message: payload.message ?? null,
            interaction: payload.interaction ?? null,
            workspace: row.assignment_id ? {
              assignment_id: row.assignment_id,
              effective_workspace: row.effective_workspace,
              status: row.workspace_status,
              confidence: row.workspace_confidence,
            } : null,
          };
        });
        return json(res, 200, { items });
      }
      return json(res, 404, { error: "not_found" });
    } catch (error) { return json(res, error.statusCode ?? 400, { error: error.message }); }
  });
  return {
    server,
    listen: () => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => { for (const stream of eventStreams) { clearInterval(stream.timer); stream.res.end(); } eventStreams.clear(); return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}
