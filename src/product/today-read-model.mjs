import { buildStateDecisionCard } from "../state/dynamic-state.mjs";
import { listCurrentPlanCandidates } from "../planning/plan-candidates.mjs";
import { getProjectAttention } from "../creator/project-changes.mjs";
import { getKnowledgeIndexHealth } from "../indexing/knowledge-index.mjs";

const PATH_LABELS = {
  "stable.mission": "长期事业主航道",
  "current.projects.tianshu": "天枢项目状态",
  "current.wellbeing.energy": "今日精力状态",
  "future.capabilities.daily_checkin": "每日主动回顾能力",
  "future.capabilities.device_companion": "持续陪伴入口",
  "future.capabilities.emotional_context": "情绪上下文能力",
};
const VALUE_LABELS = { low: "偏低", medium: "正常", high: "充足", true: "已启用", false: "未启用" };

function parse(value, fallback = null) { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } }
function humanValue(value) { const key = String(value); return VALUE_LABELS[key] ?? (typeof value === "object" ? JSON.stringify(value) : key); }
function effectFor(path) {
  if (path === "current.wellbeing.energy") return "会影响今天建议的并行任务数量和节奏。";
  if (path.startsWith("current.projects.")) return "会影响当前项目判断与后续优先级。";
  if (path.startsWith("stable.")) return "会影响长期判断基线，需要谨慎确认。";
  return "会更新天枢后续判断所使用的正式状态。";
}
export function humanizeStateChange(change) {
  return { key: change.path, label: PATH_LABELS[change.path] ?? "状态信息", previous: change.previous == null ? "尚未记录" : humanValue(change.previous), next: change.operation === "invalidate" ? "不再有效" : humanValue(change.next), impact: effectFor(change.path), source_type: change.source_type };
}
export function humanizeStateDecisionCard(card) {
  const changes = (card.changes ?? []).map(humanizeStateChange);
  return { ...card, changes, effects: ["会更新奈奈的正式状态", "不会创建任务", "不会派发 Agent"], title: changes.length === 1 ? `${changes[0].label}发生变化` : `发现 ${changes.length} 项状态变化` };
}

export function getConfirmationReadModel(db) {
  const stateItems = db.prepare("SELECT cycle_id,subject_id,input_json FROM state_update_cycles WHERE status='awaiting_creator_decision' ORDER BY created_at DESC").all().map((row) => {
    const input = parse(row.input_json, {}); const card = humanizeStateDecisionCard(buildStateDecisionCard(db, row.cycle_id));
    return { confirmation_id: row.cycle_id, type: "state", title: card.title, summary: card.summary, effects: card.effects, created_from: input.source_ref ?? null, result: { interaction: { mode: "state_candidate", fulfillment_status: "awaiting_creator_decision", completed: false, state_candidate: { status: "proposal_created", subject_id: row.subject_id, cycle_id: row.cycle_id, decision_card: card } } } };
  });
  const planItems = listCurrentPlanCandidates(db).map((candidate) => ({ confirmation_id: candidate.candidate_id, type: "plan", title: candidate.objective, summary: `完成标准 ${candidate.completion_criteria.length} 项 · 第 ${candidate.version} 版`, effects: ["会建立正式目标和计划", "不会立即启动 Agent", "执行范围仍需再次确认"], result: { intake_id: candidate.intake_id, interaction: { mode: "action_proposal", fulfillment_status: "awaiting_creator_confirmation", completed: false, plan_candidate: candidate } } }));
  const executionItems = db.prepare("SELECT p.plan_id,p.plan_json,p.risk_level,g.contract_json,b.boundary_json,b.status boundary_status FROM plans p JOIN goals g ON g.goal_id=p.goal_id JOIN execution_boundaries b ON b.plan_id=p.plan_id WHERE p.status='awaiting_approval' AND b.status IN ('awaiting_configuration','awaiting_creator_confirmation') ORDER BY p.created_at DESC").all().map((row) => { const plan=parse(row.plan_json,{}), contract=parse(row.contract_json,{}), boundary=parse(row.boundary_json,{}); const configured=row.boundary_status==='awaiting_creator_confirmation'; return { confirmation_id: row.plan_id, type: configured ? "execution" : "execution_configuration", title: contract.objective, summary: configured ? "执行范围等待你确认" : "计划已确认，需要补齐执行范围", effects: configured ? ["确认后会创建可执行任务", "本步骤仍不会自动启动 Agent", "执行者和复核者必须不同"] : ["需要选择执行 Agent 与独立复核 Agent", "需要限定允许访问的路径", "需要设置超时与重试"], result: { interaction: { mode: "execution_confirmation", completed: false, execution_candidate: { ...boundary, plan_id: row.plan_id, objective: contract.objective, risk_level: row.risk_level, expected_outputs: plan.expected_outputs ?? [], boundary_status: row.boundary_status } } } }; });
  const runItems = db.prepare("SELECT r.run_id,r.status,t.task_id,p.plan_id,g.contract_json,r.executor_result_json,v.passed,v.report_json,v.verifier,v.created_at FROM runs r JOIN tasks t ON t.task_id=r.task_id JOIN plans p ON p.plan_id=t.plan_id JOIN goals g ON g.goal_id=p.goal_id JOIN verifications v ON v.run_id=r.run_id LEFT JOIN decisions d ON d.run_id=r.run_id WHERE t.status='awaiting_creator_decision' AND d.decision_id IS NULL ORDER BY v.created_at DESC").all().map((row) => {
    const contract=parse(row.contract_json,{}), executor=parse(row.executor_result_json,{}), report=parse(row.report_json,{});
    return { confirmation_id: row.run_id, type: "run_decision", title: contract.objective, summary: row.passed ? "独立复核已通过，等待你最终接受" : "独立复核未通过，等待你决定", effects: ["接受后目标才会完成", "拒绝后保留全部执行与复核证据", "Executor 不能代替你做最终决定"], result: { interaction: { mode: "run_decision", completed: false, run_candidate: { run_id: row.run_id, task_id: row.task_id, plan_id: row.plan_id, objective: contract.objective, verification_passed: Boolean(row.passed), verifier: row.verifier, executor, report, verified_at: row.created_at } } } };
  });
  const projectChangeItems = db.prepare("SELECT c.change_id,c.project_key,c.change_type,c.previous_json,c.proposed_json,c.summary,c.impact_json,c.confidence,c.created_at,p.display_name,(SELECT COUNT(*) FROM project_change_candidates x WHERE x.project_key=c.project_key AND x.change_type=c.change_type AND x.status='awaiting_creator_confirmation' AND x.change_id<>c.change_id AND x.proposed_json<>c.proposed_json) conflict_count FROM project_change_candidates c JOIN creator_project_profiles p ON p.project_key=c.project_key WHERE c.status='awaiting_creator_confirmation' ORDER BY c.created_at DESC").all().map((row) => ({
    confirmation_id: row.change_id,
    type: "project_change",
    title: row.display_name + (row.conflict_count ? "：发现冲突变化" : "：项目变化待确认"),
    summary: row.summary,
    effects: parse(row.impact_json, []),
    result: { interaction: { mode: "project_change_confirmation", fulfillment_status: "awaiting_creator_confirmation", completed: false, project_change_candidate: { change_id: row.change_id, project_key: row.project_key, project_name: row.display_name, change_type: row.change_type, previous_value: parse(row.previous_json), proposed_value: parse(row.proposed_json), confidence: row.confidence, conflict_count: row.conflict_count, created_at: row.created_at } } }
  }));
  return [...stateItems, ...projectChangeItems, ...planItems, ...executionItems, ...runItems];
}

export function buildTodayReadModel(db) {
  const projects = db.prepare(`SELECT p.project_key,p.display_name,p.execution_policy,p.status,COALESCE(a.score,p.baseline_priority*20) score,a.priority_band,a.confidence,a.status assessment_status FROM creator_project_profiles p LEFT JOIN creator_priority_assessments a ON a.project_key=p.project_key AND a.status IN ('candidate','confirmed') ORDER BY score DESC,p.project_key`).all().map((item) => ({ ...item, priority_label: ({ focus_now: "当前聚焦", important: "重要", maintain: "保持", defer: "暂缓" })[item.priority_band] ?? "尚未评估", evidence_state: item.assessment_status === "confirmed" ? "已确认" : "待确认" }));
  for (const project of projects) {
    project.current_state = Object.fromEntries(db.prepare("SELECT state_key,value_json,source_change_id,updated_at FROM project_current_state WHERE project_key=? ORDER BY state_key").all(project.project_key).map((row) => [row.state_key, { value: parse(row.value_json), source_change_id: row.source_change_id, updated_at: row.updated_at }]));
    project.attention = getProjectAttention(db, project.project_key);
  }
  const focusProject = projects.find((item) => item.execution_policy !== "no_access") ?? null;
  const focus = focusProject ? { project_key: focusProject.project_key, title: focusProject.display_name, reason: `在当前可执行项目中优先级最高，量化分数 ${focusProject.score}。`, next_action: `明确「${focusProject.display_name}」今天唯一需要交付的结果。`, evidence: [{ type: "project_priority", score: focusProject.score, status: focusProject.assessment_status ?? "baseline" }] } : null;
  const changes = db.prepare("SELECT comparison_json,updated_at FROM state_update_cycles WHERE status IN ('accepted','corrected') ORDER BY updated_at DESC LIMIT 5").all().flatMap((row) => (parse(row.comparison_json, {}).applied_changes ?? []).map((change) => ({ ...humanizeStateChange(change), accepted_at: row.updated_at })));
  const confirmations = getConfirmationReadModel(db);
  const nextQuestion = db.prepare("SELECT question_id,question_text,why_it_matters FROM state_questions WHERE status='pending' ORDER BY asked_at LIMIT 1").get() ?? null;
  const recent = db.prepare("SELECT intake_id,source,payload_json,status,created_at FROM intake_events ORDER BY created_at DESC LIMIT 8").all().map((row) => { const payload = parse(row.payload_json, {}); return { intake_id: row.intake_id, message: payload.message ?? null, source: row.source, outcome: payload.interaction?.mode ?? row.status, created_at: row.created_at }; });
  const project_timeline = db.prepare("SELECT c.change_id,c.project_key,c.change_type,c.summary,c.previous_json,c.proposed_json,c.status,c.confidence,c.created_at,c.decided_at,p.display_name FROM project_change_candidates c JOIN creator_project_profiles p ON p.project_key=c.project_key ORDER BY c.created_at DESC LIMIT 20").all().map((row) => ({ ...row, previous_value: parse(row.previous_json), proposed_value: parse(row.proposed_json) }));
  const attention_summary = projects.filter((item) => item.execution_policy !== "no_access" && item.attention.score > 0).sort((a,b) => b.attention.score-a.attention.score).map((item) => ({ project_key:item.project_key,display_name:item.display_name,...item.attention }));
  const index_health = getKnowledgeIndexHealth(db);
  return { generated_at: new Date().toISOString(), state_authority: "sqlite", focus, changes, attention_summary, index_health, project_timeline, confirmations, projects: projects.filter((item) => item.execution_policy !== "no_access"), protected_projects: projects.filter((item) => item.execution_policy === "no_access"), next_question: nextQuestion, recent_records: recent, execution_summary: { prepared_tasks: db.prepare("SELECT COUNT(*) count FROM plans WHERE status='awaiting_approval'").get().count, running: db.prepare("SELECT COUNT(*) count FROM runs WHERE status='running'").get().count, awaiting_review: db.prepare("SELECT COUNT(*) count FROM runs WHERE status='awaiting_verification'").get().count, awaiting_creator_decision: db.prepare("SELECT COUNT(*) count FROM tasks WHERE status='awaiting_creator_decision'").get().count } };
}