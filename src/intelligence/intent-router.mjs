const DOMAIN_RULES = [
  ["creator", /我|我的身份|长期目标|主航道|喜欢|决策/],
  ["project", /项目|任务|公司|合作|市场|团队|推进|交付/],
  ["life", /生活|家里|家人|旅行|睡眠|联系|朋友/],
  ["system", /天枢|意图识别|智能体|Agent|总控|硬件|手机|录音/],
];
const TIME_RULES = [
  ["stable", /长期|一直|主航道|身份|原则/],
  ["current", /现在|目前|今天|最近|这周|当前|已经/],
  ["future", /以后|未来|接下来|将来|明天|后天|需要/],
];

export function analyzeIntent(text) {
  if (!text || typeof text !== "string") throw new Error("intent input requires text");
  const domains = DOMAIN_RULES.filter(([, rule]) => rule.test(text)).map(([name]) => name);
  const timeLayers = TIME_RULES.filter(([, rule]) => rule.test(text)).map(([name]) => name);
  const needsQuestions = /不知道|不确定|还没有|缺少|需要.*问|应该怎么/.test(text);
  const actionSignal = /帮我|完成|推进|调度|联系|安排|生成|验收/.test(text);
  return {
    intent_type: actionSignal ? "action_or_decision" : "state_update",
    domains: domains.length ? domains : ["uncategorized"],
    time_layers: timeLayers.length ? timeLayers : ["current"],
    needs_questions: needsQuestions,
    action_signal: actionSignal,
    confidence: domains.length && timeLayers.length ? "medium" : "low",
    source_text: text,
  };
}
