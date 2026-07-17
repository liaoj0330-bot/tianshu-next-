import { buildStateDecisionCard } from "../state/dynamic-state.mjs";
import { listCurrentPlanCandidates } from "../planning/plan-candidates.mjs";
import { getProjectAttention } from "../creator/project-changes.mjs";
import { getKnowledgeIndexHealth } from "../indexing/knowledge-index.mjs";
import { getExperience, getJudgment, getOutcome } from "../intelligence/judgment-loop.mjs";
import { listPendingWorkspaceAssignments } from "./workspace-assignment.mjs";
import { getProductProfile } from "./product-profile.mjs";
import { resolveConfirmationContext, resolveConfirmationIntakeId } from "./record-context.mjs";
import { listAutomations, listPendingReminders } from "../automation/reminders.mjs";
import { getProjectProgressReadModel } from "../creator/project-progress.mjs";

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
function confirmationPresentation(item) {
  const conflictCount = item.result?.interaction?.project_change_candidate?.conflict_count ?? 0;
  const map = {
    run_decision: ["结果验收", "high", "completion", "独立复核", "验收结果"],
    task_start: ["启动授权", "high", "execution", "执行边界", "启动任务"],
    execution: ["执行授权", "high", "execution", "行动计划", "批准范围"],
    execution_configuration: ["范围配置", "normal", "execution", "行动计划", "配置范围"],
    project_change: ["项目变化", conflictCount ? "high" : "normal", "formal_state", "项目观察", "确认变化"],
    state: ["状态变化", "normal", "formal_state", "状态观察", "确认状态"],
    plan: ["计划确认", "normal", "planning", "主控输入", "审阅计划"],
    workspace: ["归属确认", "normal", "organization", "主控输入", "选择归属"],
    judgment: ["判断反馈", "normal", "judgment", "认知判断", "给出反馈"],
    outcome: ["结果复盘", "normal", "learning", "执行结果", "复盘结果"],
    advisory: ["外部建议", "low", "advice", "外部来源", "判断取舍"],
    experience_version: ["经验候选", "low", "learning", "经验系统", "审阅经验"],
    experience_counterexample: ["经验反例", "high", "learning", "经验系统", "处理反例"],
    experience_usage: ["经验效果", "low", "learning", "经验系统", "评价效果"],
  };
  const [typeLabel, urgency, impact, sourceLabel, actionLabel] = map[item.type] ?? ["需要决定", "normal", "other", "天枢", "查看详情"];
  return { type_label: typeLabel, urgency, impact, source_label: sourceLabel, action_label: actionLabel };
}
function effectFor(path) {
  if (path === "current.wellbeing.energy") return "会影响今天建议的并行任务数量和节奏。";
  if (path.startsWith("current.projects.")) return "会影响当前项目判断与后续优先级。";
  if (path.startsWith("stable.")) return "会影响长期判断基线，需要谨慎确认。";
  return "会更新天枢后续判断所使用的正式状态。";
}
export function humanizeStateChange(change) {
  return { key: change.path, label: PATH_LABELS[change.path] ?? "状态信息", previous: change.previous == null ? "尚未记录" : humanValue(change.previous), next: change.operation === "invalidate" ? "不再有效" : humanValue(change.next), raw_next: change.next, operation: change.operation, impact: effectFor(change.path), source_type: change.source_type };
}
export function humanizeStateDecisionCard(card) {
  const changes = (card.changes ?? []).map(humanizeStateChange);
  return { ...card, changes, effects: ["会更新你的正式状态", "不会创建任务", "不会派发 Agent"], title: changes.length === 1 ? `${changes[0].label}发生变化` : `发现 ${changes.length} 项状态变化` };
}

function projectPosture(db, project) {
  const history = db.prepare("SELECT score,created_at FROM creator_priority_assessments WHERE project_key=? ORDER BY created_at DESC LIMIT 2").all(project.project_key);
  const previousScore = history[1]?.score ?? null;
  const delta = previousScore == null ? null : project.score - previousScore;
  const direction = delta == null ? "new" : delta >= 3 ? "up" : delta <= -3 ? "down" : "steady";
  const trendLabel = direction === "up" ? `上升 ${delta}` : direction === "down" ? `下降 ${Math.abs(delta)}` : direction === "steady" ? "基本稳定" : "首次评估";
  const state = project.current_state ?? {};
  const risk = state.risk?.value;
  const blockers = [];
  if (project.attention?.conflicts) blockers.push(`有 ${project.attention.conflicts} 组状态冲突`);
  if (project.attention?.reasons?.length) blockers.push(...project.attention.reasons);
  if (risk?.level === "high" || risk?.level === "critical") blockers.push("当前风险等级高");
  if (risk?.empty_result_false_success === true) blockers.push("存在空结果误报成功");
  if (risk?.agenthub_real_use === false) blockers.push("真实 AgentHub 链路尚未通过");
  if (risk?.provider_status && !/^(ok|healthy|ready)$/i.test(String(risk.provider_status))) blockers.push(`Provider：${risk.provider_status}`);
  if (typeof risk === "string" && risk.trim()) blockers.push(risk.trim());
  const timestamps = [project.project_updated_at, project.assessed_at, ...Object.values(state).map((item) => item?.updated_at)].filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
  const updatedAt = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
  const ageDays = updatedAt ? Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)) : null;
  const baselineEvidence = parse(project.evidence_json, []);
  const stateEvidence = new Set(Object.values(state).map((item) => item?.source_change_id).filter(Boolean));
  return {
    trend: { direction, delta, label: trendLabel },
    stage: state.stage?.value ?? null,
    next_outcome: state.note?.value?.next_action ?? null,
    blockers: [...new Set(blockers)].slice(0, 4),
    risk_level: risk?.level ?? null,
    evidence_count: baselineEvidence.length + stateEvidence.size,
    freshness: { updated_at: updatedAt, age_days: ageDays, status: ageDays == null ? "unknown" : ageDays > 7 ? "stale" : ageDays > 2 ? "aging" : "current", label: ageDays == null ? "暂无状态证据" : ageDays === 0 ? "今天更新" : `${ageDays} 天前更新` },
  };
}

export function getConfirmationReadModel(db) {
  const judgmentItems = db.prepare(`
    SELECT judgment_id FROM judgments
    WHERE status='awaiting_creator_feedback'
    ORDER BY created_at
  `).all().map((row) => {
    const judgment = getJudgment(db, row.judgment_id);
    return {
      confirmation_id: judgment.judgment_id,
      type: "judgment",
      title: `判断待确认：${judgment.question}`,
      summary: judgment.recommendation?.action ?? "天枢已经形成可解释判断，等待你的反馈。",
      effects: ["接受或纠正后才能成为正式判断", "拒绝、延后或忽略都不会启动执行", "本步骤不会自动派发 Agent"],
      result: {
        interaction: {
          mode: "judgment_feedback",
          fulfillment_status: "awaiting_creator_feedback",
          completed: false,
          decision_route: `/v1/judgments/${judgment.judgment_id}/feedback`,
          allowed_decisions: ["accept", "correct", "reject", "defer", "ignore"],
          judgment_candidate: judgment,
        },
      },
    };
  });
  const outcomeItems = db.prepare(`
    SELECT outcome_id FROM outcomes WHERE status='candidate' ORDER BY created_at
  `).all().map((row) => {
    const outcome = getOutcome(db, row.outcome_id);
    return {
      confirmation_id: outcome.outcome_id,
      type: "outcome",
      title: `结果待复盘：${outcome.summary}`,
      summary: "Executor 只报告结果；你确认或纠正后，结果才可用于生成经验。",
      effects: ["确认后允许生成经验候选", "纠正会保留原始报告和你的修正", "拒绝的结果不能生成正式经验"],
      result: {
        interaction: {
          mode: "outcome_decision",
          fulfillment_status: "awaiting_creator_decision",
          completed: false,
          decision_route: `/v1/outcomes/${outcome.outcome_id}/decision`,
          allowed_decisions: ["confirm", "correct", "reject"],
          outcome_candidate: outcome,
        },
      },
    };
  });
  const experienceVersionItems = db.prepare(`
    SELECT e.experience_id,e.title,v.version_id,v.version
    FROM experience_versions v JOIN experiences e ON e.experience_id=v.experience_id
    WHERE v.status='candidate' ORDER BY v.created_at
  `).all().map((row) => {
    const experience = getExperience(db, row.experience_id);
    const candidate = experience.versions.find((item) => item.version_id === row.version_id);
    return {
      confirmation_id: row.version_id,
      type: "experience_version",
      title: `经验版本待确认：${row.title} v${row.version}`,
      summary: candidate.rule?.then ?? candidate.rule?.action ?? "候选经验等待你决定是否激活。",
      effects: ["激活后可被后续判断明确引用", "拒绝不会覆盖当前有效版本", "经验不会直接启动执行"],
      result: {
        interaction: {
          mode: "experience_decision",
          fulfillment_status: "awaiting_creator_decision",
          completed: false,
          decision_route: `/v1/experiences/${row.experience_id}/decision`,
          allowed_decisions: ["activate", "reject"],
          experience_candidate: { ...candidate, experience_id: row.experience_id, title: row.title },
        },
      },
    };
  });
  const counterexampleItems = db.prepare(`
    SELECT c.counterexample_id,c.experience_id,e.title
    FROM experience_counterexamples c JOIN experiences e ON e.experience_id=c.experience_id
    WHERE c.status='candidate' ORDER BY c.created_at
  `).all().map((row) => {
    const counterexample = getExperience(db, row.experience_id).counterexamples
      .find((item) => item.counterexample_id === row.counterexample_id);
    return {
      confirmation_id: row.counterexample_id,
      type: "experience_counterexample",
      title: `经验反例待确认：${row.title}`,
      summary: counterexample.observation?.contradiction ?? counterexample.observation?.summary ?? "发现可能推翻当前经验适用范围的反例。",
      effects: ["确认后当前有效版本立即停止影响新判断", "拒绝后经验保持有效", "修订版本必须显式携带已确认反例"],
      result: {
        interaction: {
          mode: "experience_counterexample_decision",
          fulfillment_status: "awaiting_creator_decision",
          completed: false,
          decision_route: `/v1/experience-counterexamples/${row.counterexample_id}/decision`,
          allowed_decisions: ["confirm", "reject"],
          counterexample_candidate: counterexample,
        },
      },
    };
  });
  const experienceUsageItems = db.prepare(`
    SELECT u.usage_id,u.experience_version_id,u.judgment_id,u.influence_json,u.created_at,
           e.experience_id,e.title,v.version,j.question,j.status judgment_status
    FROM experience_usages u
    JOIN experience_versions v ON v.version_id=u.experience_version_id
    JOIN experiences e ON e.experience_id=v.experience_id
    JOIN judgments j ON j.judgment_id=u.judgment_id
    LEFT JOIN experience_usage_evaluations x ON x.usage_id=u.usage_id
    WHERE x.evaluation_id IS NULL AND j.status IN ('accepted','corrected','rejected')
    ORDER BY u.created_at
  `).all().map((row) => ({
    confirmation_id: row.usage_id,
    type: "experience_usage",
    title: `经验效果待评价：${row.title} v${row.version}`,
    summary: `这条经验被用于判断“${row.question}”，需要你评价它实际是否有帮助。`,
    effects: ["评价只记录实际影响，不改写原判断", "有害评价将成为后续修订证据", "评价本身不会自动停用经验"],
    result: {
      interaction: {
        mode: "experience_usage_evaluation",
        fulfillment_status: "awaiting_creator_decision",
        completed: false,
        decision_route: `/v1/experience-usages/${row.usage_id}/evaluation`,
        allowed_assessments: ["helpful", "harmful", "neutral", "unclear"],
        usage_candidate: {
          usage_id: row.usage_id,
          experience_id: row.experience_id,
          experience_version_id: row.experience_version_id,
          judgment_id: row.judgment_id,
          judgment_status: row.judgment_status,
          influence: parse(row.influence_json, {}),
        },
      },
    },
  }));
  const advisoryItems = db.prepare(
    "SELECT r.recommendation_id,r.topic,r.assessment,r.proposed_disposition," +
    "r.proposed_adaptation_json,r.priority,r.created_at," +
    "s.document_id,s.title source_title,s.author " +
    "FROM advisory_recommendations r " +
    "JOIN advisory_sources s ON s.source_id=r.source_id " +
    "WHERE r.status='awaiting_creator_decision' " +
    "ORDER BY CASE r.priority WHEN 'now' THEN 1 WHEN 'next' THEN 2 WHEN 'later' THEN 3 ELSE 4 END," +
    "r.created_at,r.recommendation_key"
  ).all().map((row) => ({
    confirmation_id: row.recommendation_id,
    type: "advisory",
    title: "外部建议待判断：" + row.topic,
    summary: row.assessment,
    effects: ["只记录你对这条建议的取舍", "不会自动改写正式状态", "不会自动创建任务或派发 Agent"],
    result: {
      interaction: {
        mode: "advisory_decision",
        fulfillment_status: "awaiting_creator_decision",
        completed: false,
        advisory_candidate: {
          recommendation_id: row.recommendation_id,
          source: { document_id: row.document_id, title: row.source_title, author: row.author },
          topic: row.topic,
          assessment: row.assessment,
          proposed_disposition: row.proposed_disposition,
          proposed_adaptation: parse(row.proposed_adaptation_json, {}),
          priority: row.priority,
        },
      },
    },
  }));
  const workspaceItems = listPendingWorkspaceAssignments(db).map((assignment) => ({
    confirmation_id: assignment.assignment_id,
    type: "workspace",
    title: "这条信息应该放在哪里？",
    summary: assignment.message ?? "工作空间归属缺少足够证据",
    effects: ["只会确认这条输入的归属", "不会创建任务", "不会派发 Agent"],
    result: {
      intake_id: assignment.intake_id,
      interaction: {
        mode: "workspace_confirmation",
        fulfillment_status: "awaiting_creator_confirmation",
        completed: false,
        workspace_candidate: {
          proposed_workspace: assignment.proposed_workspace,
          candidates: assignment.candidates,
          confidence: assignment.confidence,
          reason_codes: assignment.reason_codes,
        },
      },
    },
  }));
  const stateItems = db.prepare("SELECT cycle_id,subject_id,input_json FROM state_update_cycles WHERE status='awaiting_creator_decision' ORDER BY created_at DESC").all().map((row) => {
    const input = parse(row.input_json, {}); const card = humanizeStateDecisionCard(buildStateDecisionCard(db, row.cycle_id));
    return { confirmation_id: row.cycle_id, type: "state", title: card.title, summary: card.summary, effects: card.effects, created_from: input.source_ref ?? null, result: { interaction: { mode: "state_candidate", fulfillment_status: "awaiting_creator_decision", completed: false, state_candidate: { status: "proposal_created", subject_id: row.subject_id, cycle_id: row.cycle_id, decision_card: card } } } };
  });
  const planItems = listCurrentPlanCandidates(db).map((candidate) => ({ confirmation_id: candidate.candidate_id, type: "plan", title: candidate.objective, summary: candidate.alignment_summary ?? `完成标准 ${candidate.completion_criteria.length} 项 · 第 ${candidate.version} 版`, effects: candidate.project_brief ? ["只授权首轮资料核验与立项判断", "不会立即开发、交易或对外行动", "调研通过独立复核后仍由奈奈决定是否立项"] : ["会建立正式目标和计划", "不会立即启动 Agent", "执行范围仍需再次确认"], result: { intake_id: candidate.intake_id, interaction: { mode: candidate.project_brief ? "project_alignment" : "action_proposal", fulfillment_status: "awaiting_creator_confirmation", completed: false, plan_candidate: candidate } } }));
  const executionItems = db.prepare("SELECT p.plan_id,p.plan_json,p.risk_level,g.contract_json,b.boundary_json,b.status boundary_status FROM plans p JOIN goals g ON g.goal_id=p.goal_id JOIN execution_boundaries b ON b.plan_id=p.plan_id WHERE p.status='awaiting_approval' AND b.status IN ('awaiting_configuration','awaiting_creator_confirmation') ORDER BY p.created_at DESC").all().map((row) => { const plan=parse(row.plan_json,{}), contract=parse(row.contract_json,{}), boundary=parse(row.boundary_json,{}); const configured=row.boundary_status==='awaiting_creator_confirmation'; return { confirmation_id: row.plan_id, type: configured ? "execution" : "execution_configuration", title: contract.objective, summary: configured ? "执行范围等待你确认" : "计划已确认，需要补齐执行范围", effects: configured ? ["确认后会创建可执行任务", "本步骤仍不会自动启动 Agent", "执行者和复核者必须不同"] : ["需要选择执行 Agent 与独立复核 Agent", "需要限定允许访问的路径", "需要设置超时与重试"], result: { interaction: { mode: "execution_confirmation", completed: false, execution_candidate: { ...boundary, workspace_root: process.cwd(), plan_id: row.plan_id, objective: contract.objective, risk_level: row.risk_level, expected_outputs: plan.expected_outputs ?? [], boundary_status: row.boundary_status } } } }; });
  const taskStartItems = db.prepare(`
    SELECT t.task_id,p.plan_id,g.contract_json,b.boundary_json
    FROM tasks t
    JOIN plans p ON p.plan_id=t.plan_id
    JOIN goals g ON g.goal_id=p.goal_id
    JOIN execution_boundaries b ON b.plan_id=p.plan_id
    WHERE t.status='approved' AND b.status='approved'
      AND NOT EXISTS (
        SELECT 1 FROM jobs j
        WHERE json_extract(j.payload_json,'$.type')='managed_execution'
          AND json_extract(j.payload_json,'$.task_id')=t.task_id
      )
    ORDER BY t.created_at DESC
  `).all().map((row) => {
    const contract=parse(row.contract_json,{}), boundary=parse(row.boundary_json,{});
    return { confirmation_id: row.task_id, type: "task_start", title: contract.objective, summary: "执行范围已批准，等待你启动", effects: ["启动后由指定 Executor 执行", "随后由不同 Agent 独立复核", "只有你最终接受后目标才会完成"], result: { interaction: { mode: "task_start_confirmation", completed: false, task_candidate: { task_id: row.task_id, plan_id: row.plan_id, objective: contract.objective, ...boundary } } } };
  });
  const runItems = db.prepare("SELECT r.run_id,r.status,t.task_id,p.plan_id,g.contract_json,r.executor_result_json,v.passed,v.report_json,v.verifier,v.created_at FROM runs r JOIN tasks t ON t.task_id=r.task_id JOIN plans p ON p.plan_id=t.plan_id JOIN goals g ON g.goal_id=p.goal_id JOIN verifications v ON v.run_id=r.run_id LEFT JOIN decisions d ON d.run_id=r.run_id WHERE t.status='awaiting_creator_decision' AND d.decision_id IS NULL ORDER BY v.created_at DESC").all().map((row) => {
    const contract=parse(row.contract_json,{}), executor=parse(row.executor_result_json,{}), report=parse(row.report_json,{});
    return { confirmation_id: row.run_id, type: "run_decision", title: contract.objective, summary: row.passed ? "独立复核已通过，等待你最终接受" : "独立复核未通过，等待你决定", effects: ["接受后目标才会完成", "拒绝后保留全部执行与复核证据", "Executor 不能代替你做最终决定"], result: { interaction: { mode: "run_decision", completed: false, run_candidate: { run_id: row.run_id, task_id: row.task_id, plan_id: row.plan_id, objective: contract.objective, verification_passed: Boolean(row.passed), verifier: row.verifier, executor, report, verified_at: row.created_at } } } };
  });
  const projectChangeItems = db.prepare("SELECT c.change_id,c.project_key,c.change_type,c.previous_json,c.proposed_json,c.summary,c.impact_json,c.confidence,c.created_at,p.display_name,(SELECT COUNT(*) FROM project_change_candidates x WHERE x.project_key=c.project_key AND x.change_type=c.change_type AND x.status='awaiting_creator_confirmation' AND x.change_id<>c.change_id AND x.proposed_json<>c.proposed_json) conflict_count FROM project_change_candidates c JOIN creator_project_profiles p ON p.project_key=c.project_key WHERE c.status='awaiting_creator_confirmation' AND p.execution_policy!='no_access' ORDER BY c.created_at DESC").all().map((row) => ({
    confirmation_id: row.change_id,
    type: "project_change",
    title: row.display_name + (row.conflict_count ? "：发现冲突变化" : "：项目变化待确认"),
    summary: row.summary,
    effects: parse(row.impact_json, []),
    result: { interaction: { mode: "project_change_confirmation", fulfillment_status: "awaiting_creator_confirmation", completed: false, project_change_candidate: { change_id: row.change_id, project_key: row.project_key, project_name: row.display_name, change_type: row.change_type, previous_value: parse(row.previous_json), proposed_value: parse(row.proposed_json), confidence: row.confidence, conflict_count: row.conflict_count, created_at: row.created_at } } }
  }));
  return [
    ...judgmentItems,
    ...outcomeItems,
    ...experienceVersionItems,
    ...counterexampleItems,
    ...experienceUsageItems,
    ...advisoryItems,
    ...workspaceItems,
    ...stateItems,
    ...projectChangeItems,
    ...planItems,
    ...executionItems,
    ...taskStartItems,
    ...runItems,
  ].map((item) => {
    const intakeId = resolveConfirmationIntakeId(db, item);
    const origin = intakeId ? db.prepare(`
      SELECT i.intake_id,i.source,i.payload_json,i.created_at,w.effective_workspace
      FROM intake_events i LEFT JOIN workspace_assignments w ON w.intake_id=i.intake_id
      WHERE i.intake_id=?
    `).get(intakeId) : null;
    const payload = parse(origin?.payload_json, {});
    return {
      ...item,
      origin: origin ? {
        intake_id: origin.intake_id,
        source: origin.source,
        message: payload.message ?? null,
        created_at: origin.created_at,
        workspace: origin.effective_workspace ?? null,
      } : null,
      context: resolveConfirmationContext(db, item),
      presentation: confirmationPresentation(item),
    };
  }).sort((left, right) => {
    const visibility = { primary: 0, secondary: 1, hidden: 2 };
    const urgency = { high: 0, normal: 1, low: 2 };
    return (visibility[left.context.visibility] ?? 3) - (visibility[right.context.visibility] ?? 3) ||
      (urgency[left.presentation.urgency] ?? 3) - (urgency[right.presentation.urgency] ?? 3);
  });
}

export function buildTodayReadModel(db) {
  const profile = getProductProfile(db);
  const projects = db.prepare(`SELECT p.project_key,p.display_name,p.execution_policy,p.status,p.evidence_json,p.updated_at project_updated_at,COALESCE(a.score,p.baseline_priority*20) score,a.priority_band,a.confidence,a.status assessment_status,a.created_at assessed_at FROM creator_project_profiles p LEFT JOIN creator_priority_assessments a ON a.project_key=p.project_key AND a.status IN ('candidate','confirmed') ORDER BY score DESC,p.project_key`).all().map((item) => ({ ...item, priority_label: ({ focus_now: "当前聚焦", important: "重要", maintain: "保持", defer: "暂缓" })[item.priority_band] ?? "尚未评估", evidence_state: item.assessment_status === "confirmed" ? "已确认" : "待确认" }));
  for (const project of projects) {
    project.current_state = Object.fromEntries(db.prepare("SELECT state_key,value_json,source_change_id,updated_at FROM project_current_state WHERE project_key=? ORDER BY state_key").all(project.project_key).map((row) => [row.state_key, { value: parse(row.value_json), source_change_id: row.source_change_id, updated_at: row.updated_at }]));
    project.progress = getProjectProgressReadModel(db, project.project_key);
    project.attention = getProjectAttention(db, project.project_key);
    project.posture = projectPosture(db, project);
    delete project.evidence_json;
    delete project.project_updated_at;
    delete project.assessed_at;
  }
  const visibleProjects = projects.filter((item) => item.execution_policy !== "no_access");
  const protectedProjectCount = projects.length - visibleProjects.length;
  const focusProject = visibleProjects[0] ?? null;
  const focus = focusProject ? { project_key: focusProject.project_key, title: focusProject.display_name, reason: `在当前可执行项目中优先级最高，量化分数 ${focusProject.score}。`, next_action: `明确「${focusProject.display_name}」今天唯一需要交付的结果。`, evidence: [{ type: "project_priority", score: focusProject.score, status: focusProject.assessment_status ?? "baseline" }] } : null;
  const changes = db.prepare("SELECT comparison_json,updated_at FROM state_update_cycles WHERE status IN ('accepted','corrected') ORDER BY updated_at DESC LIMIT 5").all().flatMap((row) => (parse(row.comparison_json, {}).applied_changes ?? []).map((change) => ({ ...humanizeStateChange(change), accepted_at: row.updated_at })));
  const confirmations = getConfirmationReadModel(db);
  const decisionSummary = {
    primary: confirmations.filter((item) => item.context.visibility === "primary").length,
    secondary: confirmations.filter((item) => item.context.visibility === "secondary").length,
    hidden: confirmations.filter((item) => item.context.visibility === "hidden").length,
    by_context: Object.fromEntries(["product", "development", "acceptance", "system"].map((kind) => [kind, confirmations.filter((item) => item.context.context_kind === kind).length])),
  };
  const nextQuestion = db.prepare("SELECT question_id,question_text,why_it_matters FROM state_questions WHERE status='pending' ORDER BY asked_at LIMIT 1").get() ?? null;
  const recent = db.prepare(`SELECT i.intake_id,i.source,i.payload_json,i.status,i.created_at,w.effective_workspace,w.status workspace_status FROM intake_events i LEFT JOIN workspace_assignments w ON w.intake_id=i.intake_id ORDER BY i.created_at DESC LIMIT 8`).all().map((row) => {
    const payload = parse(row.payload_json, {});
    const interaction = payload.interaction ?? {};
    const materialSource = Array.isArray(interaction.project_brief?.materials)
      ? interaction.project_brief.materials
      : Array.isArray(payload.materials) ? payload.materials : [];
    const materials = materialSource.map(({ text_content, content_data_url, ...item }) => item);
    return {
      intake_id: row.intake_id,
      message: payload.message ?? null,
      source: row.source,
      workspace: row.effective_workspace ?? null,
      workspace_status: row.workspace_status ?? null,
      outcome: interaction.mode ?? row.status,
      fulfillment_status: interaction.fulfillment_status ?? row.status,
      answer: interaction.answer ?? null,
      next_action: interaction.answer?.next_action ?? interaction.next_action ?? null,
      confirmation_id: interaction.plan_candidate?.candidate_id ?? interaction.state_candidate?.cycle_id ?? null,
      materials,
      project_brief: interaction.project_brief ?? null,
      material_receipt: interaction.material_receipt ?? null,
      current_question: interaction.current_question ?? null,
      material_dialogue_id: interaction.material_dialogue_id ?? null,
      record_kind: interaction.material_dialogue_id ? "agenthub_material_dialogue" : "intake",
      created_at: row.created_at,
    };
  });
  const project_timeline = db.prepare("SELECT c.change_id,c.project_key,c.change_type,c.summary,c.previous_json,c.proposed_json,c.status,c.confidence,c.created_at,c.decided_at,p.display_name FROM project_change_candidates c JOIN creator_project_profiles p ON p.project_key=c.project_key WHERE p.execution_policy!='no_access' ORDER BY c.created_at DESC LIMIT 20").all().map((row) => ({ ...row, previous_value: parse(row.previous_json), proposed_value: parse(row.proposed_json) }));
  const attention_summary = visibleProjects.filter((item) => item.attention.score > 0).sort((a,b) => b.attention.score-a.attention.score).map((item) => ({ project_key:item.project_key,display_name:item.display_name,...item.attention }));
  const index_health = getKnowledgeIndexHealth(db);
  const automations = listAutomations(db);
  const reminders = listPendingReminders(db);
  return {
    generated_at: new Date().toISOString(),
    state_authority: "sqlite",
    decision_authority: profile.actor_id,
    creator_profile: profile,
    surface_contract: {
      surface: "today",
      read_only: true,
      pending_confirmation_count: confirmations.length,
      primary_confirmation_count: decisionSummary.primary,
      agenthub: {
        submit_route: "/v1/channels/agenthub/messages",
        today_route: "/v1/channels/agenthub/today",
        reconnect_route_template: "/v1/channels/agenthub/sessions/:session_id",
        cockpit_route: "/agenthub",
        confirmation_link_template: "/agenthub?confirmation=:confirmation_id",
        can_submit: true,
        can_confirm: false,
        can_execute: false,
      },
    },
    focus,
    changes,
    attention_summary,
    index_health,
    automations: automations.slice(0, 8),
    reminders,
    automation_summary: {
      active: automations.filter((item) => item.status === "active").length,
      paused: automations.filter((item) => item.status === "paused").length,
      pending_reminders: reminders.length,
    },
    project_timeline,
    confirmations,
    decision_summary: decisionSummary,
    projects: visibleProjects,
    protected_project_count: protectedProjectCount,
    next_question: nextQuestion,
    recent_records: recent,
    material_conversations: {
      awaiting_answer: db.prepare("SELECT COUNT(*) count FROM material_dialogues WHERE status='awaiting_answer'").get().count,
      awaiting_understanding_confirmation: db.prepare("SELECT COUNT(*) count FROM material_dialogues WHERE status='understanding_ready'").get().count,
    },
    execution_summary: {
      prepared_tasks: db.prepare("SELECT COUNT(*) count FROM plans WHERE status='awaiting_approval'").get().count,
      running: db.prepare("SELECT COUNT(*) count FROM runs WHERE status='running'").get().count,
      awaiting_review: db.prepare("SELECT COUNT(*) count FROM runs WHERE status='awaiting_verification'").get().count,
      awaiting_creator_decision: db.prepare("SELECT COUNT(*) count FROM tasks WHERE status='awaiting_creator_decision'").get().count,
      queued_jobs: db.prepare("SELECT COUNT(*) count FROM jobs WHERE status IN ('queued','leased','retry_wait','recovery_required')").get().count,
    },
  };
}
