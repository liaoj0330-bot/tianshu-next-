export function buildActionPlanCandidate(message, interaction, { project_match = null, material_brief = null } = {}) {
  const text = String(message ?? "").trim();
  if (!text) throw new Error("message is required");
  if (material_brief) {
    const minutes = material_brief.schedule.first_pass_effort_minutes;
    return {
      candidate_status: "awaiting_creator_confirmation",
      objective: `完成「${material_brief.title}」首轮资料核验与立项判断`,
      completion_criteria: [
        "形成逐项素材清单，标记可访问性、来源、主题和核心主张",
        "形成事实、推断、宣传表述与未知项分离的证据矩阵",
        "给出可学、不可直接照搬、适配方式与最小验证建议",
        "由不同 Agent 独立复核证据链，再提交是否立项的结论",
      ],
      scope: ["只读处理本次提交的素材及允许访问的公开来源", "只形成首轮调研与立项判断"],
      non_goals: ["不进行真实交易或资金操作", "不直接开发完整系统", "不对外联系、发布或承诺", "不把未经核验的收益表述当成事实"],
      required_evidence: ["逐项来源记录", "主张与证据对应关系", "关键主张交叉核验", "独立复核报告"],
      risk_level: "L1",
      proposed_steps: material_brief.research_plan,
      suggested_agents: {
        researcher: "负责逐项读取、去重和来源记录",
        analyst: "负责可信度、适配价值、风险和最小验证判断",
        verifier: "必须独立检查证据覆盖与结论越界",
      },
      execution_boundary: { allowed_paths: [], external_actions: false, execution_started: false },
      proposed_schedule: { ...material_brief.schedule, first_pass_label: `首轮预计 ${minutes} 分钟` },
      project_brief: material_brief,
      alignment_summary: `${material_brief.judgment.recommendation} ${material_brief.schedule.sequencing}`,
      creator_decision: { question: material_brief.alignment.decision, options: material_brief.alignment.options, consequence: material_brief.alignment.note },
    };
  }
  const controlled = interaction.mode === "dispatch_request";
  const asksEvidence = /证据|依据|验收|检查/.test(text);
  const objective = text.replace(/^(请你|请|帮我|需要你)\s*/, "").replace(/[。！!]$/, "");
  const completion = [
    `形成可检查的结果：${objective}`,
    asksEvidence ? "列出每项判断对应的证据及来源" : "说明完成内容、未完成内容与限制",
    "结果通过独立复核后再交给用户最终确认",
  ];
  const risk = controlled ? "L2" : "L1";
  return {
    candidate_status: "awaiting_creator_confirmation",
    objective,
    completion_criteria: completion,
    scope: project_match?.project ? [`仅限项目：${project_match.project.display_name}`] : ["仅使用天枢正式登记且允许访问的范围"],
    non_goals: ["不访问 no_access、受保护或未登记项目", "不代表用户对外沟通或作出承诺"],
    required_evidence: asksEvidence ? ["内容证据", "来源或 SQLite 记录", "独立复核报告"] : ["实际产出", "前后差异", "独立复核报告"],
    risk_level: risk,
    proposed_steps: ["读取最小必要上下文", "生成候选结果", "由不同 Agent 独立复核", "提交用户最终确认"],
    suggested_agents: { executor: "待调度器按能力选择", verifier: "必须不同于执行者" },
    execution_boundary: { allowed_paths: [], external_actions: false, execution_started: false },
    creator_decision: { question: "是否按这份目标、完成标准和边界建立正式计划？", options: ["approve", "revise", "reject"] },
  };
}
