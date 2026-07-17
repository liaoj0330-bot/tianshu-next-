export const WORKSPACES = Object.freeze([
  "today",
  "projects",
  "life",
  "relationships",
  "knowledge",
  "evolution",
  "activity",
  "inbox",
]);

const RULES = Object.freeze({
  relationships: /家人|父母|孩子|伴侣|朋友|同事关系|客户关系|联系谁|沟通|关心|生日|纪念日/,
  evolution: /长期记忆|记住|忘记|经验|教训|复盘|进化|偏好|身份|原则|以后遇到|下次.*应该/,
  activity: /运行状态|执行状态|任务状态|agent.*状态|智能体.*状态|超时|重试|取消|恢复|验证结果|日志|服务健康/i,
  knowledge: /资料|文档|知识|证据|来源|研究|调研|查找|检索|总结.*材料|分析.*材料/,
  life: /生活|睡眠|精力|身体|健康|旅行|休息|家庭安排|个人安排|情绪/,
  projects: /项目|任务|交付|合作|客户|公司|团队|产品|开发|上线|需求|里程碑/,
  today: /今天.*(做什么|优先|重点|安排)|现在.*(做什么|优先)|当前.*(重点|优先)|待确认|需要我决定/,
});

function unique(values) {
  return [...new Set(values)];
}

export function classifyWorkspace(message, { analysis = {}, source = "unknown" } = {}) {
  const text = String(message ?? "").trim();
  if (!text) throw new Error("workspace classification requires message");

  const explicitProjectContext = /正式项目|纳入.{0,12}项目体系|项目线索|项目需求|客户.{0,20}(?:资料|需求)/u.test(text);

  const matches = Object.entries(RULES)
    .filter(([, rule]) => rule.test(text))
    .map(([workspace]) => workspace);

  const domains = new Set(analysis.domains ?? []);
  if (domains.has("project") && !matches.includes("projects")) matches.push("projects");
  if (domains.has("life") && !matches.includes("life")) matches.push("life");
  if (domains.has("system") && !matches.some((item) => ["activity", "evolution"].includes(item))) {
    matches.push("activity");
  }

  const candidates = unique(matches);
  if (explicitProjectContext && candidates.includes("projects")) {
    return {
      workspace: "projects",
      status: "classified",
      confidence: "high",
      candidates,
      reason_codes: ["explicit_project_context_overrides_material_form"],
      source,
    };
  }
  const substantive = candidates.filter((item) => item !== "today");
  if (substantive.length > 1) {
    return {
      workspace: "inbox",
      status: "needs_creator_confirmation",
      confidence: "low",
      candidates,
      reason_codes: ["multiple_workspace_concerns"],
      source,
    };
  }

  const workspace = substantive[0] ?? candidates[0] ?? "inbox";
  if (workspace === "inbox") {
    return {
      workspace,
      status: "unresolved",
      confidence: "low",
      candidates: [],
      reason_codes: ["no_workspace_evidence"],
      source,
    };
  }

  return {
    workspace,
    status: "classified",
    confidence: candidates.length === 1 ? "high" : "medium",
    candidates,
    reason_codes: candidates.includes("today") && workspace !== "today"
      ? ["content_workspace_overrides_attention_view"]
      : ["workspace_rule_match"],
    source,
  };
}
