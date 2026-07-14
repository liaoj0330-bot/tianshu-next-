export function buildActionPlanCandidate(message, interaction, { project_match = null } = {}) {
  const text = String(message ?? "").trim();
  if (!text) throw new Error("message is required");
  const controlled = interaction.mode === "dispatch_request";
  const asksEvidence = /证据|依据|验收|检查/.test(text);
  const objective = text.replace(/^(请你|请|帮我|需要你)\s*/, "").replace(/[。！!]$/, "");
  const completion = [
    `形成可检查的结果：${objective}`,
    asksEvidence ? "列出每项判断对应的证据及来源" : "说明完成内容、未完成内容与限制",
    "结果通过独立复核后再交给奈奈最终确认",
  ];
  const risk = controlled ? "L2" : "L1";
  return {
    candidate_status: "awaiting_creator_confirmation",
    objective,
    completion_criteria: completion,
    scope: project_match?.project ? [`仅限项目：${project_match.project.display_name}`] : ["仅使用天枢正式登记且允许访问的范围"],
    non_goals: ["不访问 no_access、受保护或未登记项目", "不代表奈奈对外沟通或作出承诺"],
    required_evidence: asksEvidence ? ["内容证据", "来源或 SQLite 记录", "独立复核报告"] : ["实际产出", "前后差异", "独立复核报告"],
    risk_level: risk,
    proposed_steps: ["读取最小必要上下文", "生成候选结果", "由不同 Agent 独立复核", "提交奈奈最终确认"],
    suggested_agents: { executor: "待调度器按能力选择", verifier: "必须不同于执行者" },
    execution_boundary: { allowed_paths: [], external_actions: false, execution_started: false },
    creator_decision: { question: "是否按这份目标、完成标准和边界建立正式计划？", options: ["approve", "revise", "reject"] },
  };
}