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
import { buildTodayReadModel, getConfirmationReadModel, humanizeStateDecisionCard } from "../product/today-read-model.mjs";
import { createPlanCandidate, decidePlanCandidate, getCurrentPlanCandidate, revisePlanCandidate } from "../planning/plan-candidates.mjs";
import { configureExecutionBoundary, createExecutionBoundary, decideExecutionBoundary, getExecutionBoundary } from "../planning/execution-boundary.mjs";

import { assessCreatorProject, getCreatorPortfolio, upsertCreatorProjectBaseline } from "../creator/project-priority.mjs";
import { proposeProjectChange, decideProjectChange, listProjectChanges, getProjectCurrentState } from "../creator/project-changes.mjs";
import { matchCreatorProject } from "../creator/project-match.mjs";
import { buildResumePacket, closeTurn, createContinuationCheckpoint, listProblems, recordProblemCase, listEvolutionCandidates } from "../continuity/continuity.mjs";
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const DASHBOARD_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>天枢总控</title><style>
body{margin:0;background:#0b1220;color:#edf2f7;font:16px system-ui,"Microsoft YaHei",sans-serif}main{max-width:1180px;margin:0 auto;padding:32px}h1{font-size:32px;margin:0 0 8px}.muted{color:#9fb0c2}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:24px}.card{background:#142238;border:1px solid #263b55;border-radius:14px;padding:20px}.wide{grid-column:1/-1}textarea{width:100%;min-height:130px;background:#0e192a;color:#edf2f7;border:1px solid #38516d;border-radius:10px;padding:12px;box-sizing:border-box;font:inherit}button{margin-top:12px;background:#2dd4bf;color:#06211e;border:0;border-radius:9px;padding:10px 18px;font-weight:700;cursor:pointer}pre{white-space:pre-wrap;color:#b8c7d9;line-height:1.55}.pill{display:inline-block;border-radius:999px;padding:5px 10px;background:#1d344e;color:#7ee7d7;font-size:13px}</style></head><body><main>
<div class="muted">TIANSHU ORCHESTRATOR / SINGLE CONTROL PLANE</div><h1>天枢总控</h1><div class="muted">你只需要输入目标，系统负责理解、调度、验收和回写。</div>
<div class="grid"><section class="card"><div class="muted">控制平面</div><h2 id="health">检查中…</h2><span class="pill">SQLite 状态真相</span></section><section class="card"><div class="muted">当前入口</div><h2>自然语言目标</h2><span class="pill">AgentHub / 手机 / 硬件</span></section><section class="card"><div class="muted">当前原则</div><h2>先判断，再执行</h2><span class="pill">独立验收</span></section><section class="card wide"><div class="muted">告诉天枢你要什么</div><textarea id="message" placeholder="例如：最近澳大利亚合作发生重大变化，请判断我的当前优先级，并告诉我还缺什么信息。"></textarea><button onclick="send()">交给天枢处理</button><pre id="result">等待输入…</pre></section><section class="card wide"><div class="muted">最近收到的目标</div><pre id="intakes">加载中…</pre></section></div></main><script>
async function load(){const h=await fetch('/health').then(r=>r.json());document.querySelector('#health').textContent=h.status==='ok'?'在线':'异常';const x=await fetch('/v1/intakes').then(r=>r.json());document.querySelector('#intakes').textContent=x.items.length?x.items.map(i=>i.created_at+'  '+i.source+'  '+i.status).join('\\n'):'暂无目标';}async function send(){const message=document.querySelector('#message').value.trim();if(!message)return;const r=await fetch('/v1/intake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'dashboard',message,metadata:{client:'tianshu-dashboard'}})});document.querySelector('#result').textContent=JSON.stringify(await r.json(),null,2);document.querySelector('#message').value='';load();}load();
</script></body></html>`;

async function body(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  if (!data) return {};
  try { return JSON.parse(data); } catch { throw new Error("invalid JSON body"); }
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
      for (const item of listProjectChanges(db, { after_id: cursor })) {
        cursor = Number(item.cursor);
        res.write("id: " + cursor + "\n");
        res.write("event: project-change\n");
        res.write("data: " + JSON.stringify({ change_id: item.change_id, project_key: item.project_key, status: item.status, cursor }) + "\n\n");
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
      }      if (req.method === "GET" && req.url === "/health") {
        return json(res, 200, { status: "ok", control_plane: "tianshu-orchestrator", state_store: "sqlite", ...(health ? health() : {}) });
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
      if (req.method === "GET" && req.url === "/v1/today") {
        return json(res, 200, buildTodayReadModel(db));
      }
      if (req.method === "GET" && req.url === "/v1/confirmations") {
        return json(res, 200, { items: getConfirmationReadModel(db), state_authority: "sqlite" });
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
      if (req.method === "GET" && req.url === "/v1/creator/portfolio") {
        return json(res, 200, { state_authority: "sqlite", items: getCreatorPortfolio(db) });
      }
      if (req.method === "POST" && req.url === "/v1/creator/portfolio/import") {
        const input = await body(req);
        return json(res, 201, { project_keys: upsertCreatorProjectBaseline(db, input), state_authority: "sqlite" });
      }
      if (req.method === "GET" && continuityUrl.pathname === "/v1/project-changes") {
        return json(res, 200, { items: listProjectChanges(db, { project_key: continuityUrl.searchParams.get("project_key"), status: continuityUrl.searchParams.get("status"), after_id: continuityUrl.searchParams.get("after_id") }), state_authority: "sqlite" });
      }
      const projectChangeCreateMatch = continuityUrl.pathname.match(/^\/v1\/creator\/projects\/([^/]+)\/changes$/);
      if (projectChangeCreateMatch && req.method === "POST") {
        return json(res, 201, { change: proposeProjectChange(db, decodeURIComponent(projectChangeCreateMatch[1]), await body(req)), state_authority: "sqlite" });
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
      const planDecisionMatch = req.url.match(/^\/v1\/intakes\/([^/]+)\/plan-decision$/);
      if (planDecisionMatch && req.method === "POST") {
        const input = await body(req);
        if (!["approve", "reject"].includes(input.decision)) return json(res, 400, { error: "invalid plan decision" });
        const intake = db.prepare("SELECT * FROM intake_events WHERE intake_id=?").get(planDecisionMatch[1]);
        if (!intake) return json(res, 404, { error: "intake not found" });
        if (db.prepare("SELECT 1 FROM intake_confirmations WHERE intake_id=?").get(intake.intake_id)) return json(res, 409, { error: "intake plan already decided" });
        const payload = JSON.parse(intake.payload_json);
        const candidate = getCurrentPlanCandidate(db, intake.intake_id);
        if (!candidate) return json(res, 400, { error: "intake has no current plan candidate" });
        const stamp = now();
        db.prepare("INSERT INTO intake_confirmations VALUES (?, 'plan', ?, NULL, ?, ?, ?)").run(intake.intake_id, input.decision, input.decided_by ?? "creator", stamp, stamp);
        if (input.decision !== "approve") {
          if (input.decision === "reject") decidePlanCandidate(db, candidate.candidate_id, "reject");
          appendEvent(db, "intake", intake.intake_id, `intake.plan_${input.decision}d`, { decided_by: input.decided_by ?? "creator" });
          return json(res, 200, { intake_id: intake.intake_id, status: "rejected", execution_started: false });
        }
        const contract = {
          objective: candidate.objective,
          completion_criteria: candidate.completion_criteria,
          original_request: payload.message,
          real_goal: candidate.objective,
          success_criteria: candidate.completion_criteria,
          non_goals: candidate.non_goals,
          constraints: [...candidate.scope, "未经奈奈最终确认不得完成目标"],
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
        const entities = { goal_id: goalId, plan_id: planId, task_id: null };
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
      if (req.method === "GET" && (req.url === "/" || req.url === "/dashboard")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(DASHBOARD_HTML);
      }
      if (req.method === "POST" && req.url === "/v1/intake") {
        const input = await body(req);
        if (!input.message || typeof input.message !== "string") return json(res, 400, { error: "message is required" });
        const intakeId = newId("intake");
        const rawAnalysis = analyzeIntent(input.message);
        const analysis = { ...rawAnalysis, operating_domain: classifyOperatingDomain(rawAnalysis) };
        const interaction = decideIntakeInteraction(input.message, analysis);
        if (interaction.mode === "direct_answer") {
          const answer = composeGroundedAnswer(db, input.message, { subject_id: input.metadata?.subject_id ?? "creator" });
          interaction.answer = answer;
          interaction.completed = answer.completed;
          interaction.fulfillment_status = answer.completed ? "answered" : "awaiting_user_input";
          if (answer.question) interaction.question = answer.question;
        }
        if (["action_proposal", "dispatch_request"].includes(interaction.mode)) {
          const projectMatch = matchCreatorProject(input.message, getCreatorPortfolio(db));
          if (projectMatch.status === "blocked") {
            interaction.fulfillment_status = "blocked_by_project_policy";
            interaction.question = "该项目禁止访问。你是否要改为天枢正式允许的项目？";
          } else {
            interaction.plan_candidate = buildActionPlanCandidate(input.message, interaction, { project_match: projectMatch });
            interaction.fulfillment_status = "awaiting_creator_confirmation";
            interaction.next_action = "confirm_plan_candidate";
          }
        }
        if (interaction.mode === "state_candidate") {
          const subjectId = input.metadata?.subject_id ?? "creator";
          const subjectExists = Boolean(db.prepare("SELECT 1 FROM state_subjects WHERE subject_id=?").get(subjectId));
          const extraction = extractCreatorSignals(input.message);
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
        db.prepare("INSERT INTO intake_events VALUES (?, ?, ?, 'accepted', ?)").run(intakeId, input.source ?? "unknown", canonicalJson({ message: input.message, metadata: input.metadata ?? {}, analysis, interaction }), now());
        if (interaction.plan_candidate) {
          interaction.plan_candidate = createPlanCandidate(db, intakeId, interaction.plan_candidate);
          db.prepare("UPDATE intake_events SET payload_json=? WHERE intake_id=?").run(canonicalJson({ message: input.message, metadata: input.metadata ?? {}, analysis, interaction }), intakeId);
        }
        appendEvent(db, "intake", intakeId, "intake.accepted", { source: input.source ?? "unknown", interaction_mode: interaction.mode });
        return json(res, 202, { intake_id: intakeId, status: "accepted", routed_to: "tianshu-orchestrator", state_authority: "sqlite", next: interaction.next_action ?? interaction.mode, interaction, analysis });
      }
      if (req.method === "POST" && req.url === "/v1/device/events") {
        const input = await body(req);
        if (!input.device_id || !input.event_type) return json(res, 400, { error: "device_id and event_type are required" });
        const message = typeof input.payload?.text === "string" ? input.payload.text : `${input.event_type} from ${input.device_id}`;
        const rawAnalysis = analyzeIntent(message);
        const analysis = { ...rawAnalysis, operating_domain: classifyOperatingDomain(rawAnalysis) };
        const eventId = newId("device_event");
        db.prepare("INSERT INTO intake_events VALUES (?, ?, ?, 'accepted', ?)").run(eventId, `device:${input.device_id}`, canonicalJson({ device_id: input.device_id, event_type: input.event_type, payload: input.payload ?? {}, analysis }), input.observed_at ?? now());
        appendEvent(db, "device_event", eventId, "device_event.accepted", { device_id: input.device_id, event_type: input.event_type });
        return json(res, 202, { event_id: eventId, status: "accepted", routed_to: "tianshu-orchestrator", analysis });
      }
      if (req.method === "GET" && req.url === "/v1/intakes") {
        const items = db.prepare("SELECT intake_id, source, payload_json, status, created_at FROM intake_events ORDER BY created_at DESC").all().map((row) => {
          const payload = JSON.parse(row.payload_json);
          return { intake_id: row.intake_id, source: row.source, status: row.status, created_at: row.created_at, message: payload.message ?? null, interaction: payload.interaction ?? null };
        });
        return json(res, 200, { items });
      }
      return json(res, 404, { error: "not_found" });
    } catch (error) { return json(res, 400, { error: error.message }); }
  });
  return {
    server,
    listen: () => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => { for (const stream of eventStreams) { clearInterval(stream.timer); stream.res.end(); } eventStreams.clear(); return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}
