const has = (text, pattern) => pattern.test(text);

export function extractCreatorSignals(text) {
  if (!text || typeof text !== "string") throw new Error("creator text is required");
  const signals = [];
  const questions = [];
  const add = (path, value, confidence = "medium", source_type = "creator_explicit") =>
    signals.push({ path, operation: "set", value, confidence, source_type });

  if (has(text, /高校|产教融合|高校教育/)) add("stable.mission", "高校AI教育体系与产教融合", "high");
  if (has(text, /个人IP|自己的IP/)) add("stable.strategic_directions.personal_ip", true, "high");
  if (has(text, /天枢|言出法随/)) add("current.projects.tianshu", "个人AI工作系统与主动陪伴系统", "high");
  if (has(text, /手机|硬件|摄像头|睡眠/)) add("future.capabilities.device_companion", "手机与硬件作为持续输入入口", "medium");
  if (has(text, /每天.*晚上|定时|每天.*总结/)) add("future.capabilities.daily_checkin", "通过定时主动询问建立每日状态更新习惯", "high");
  if (has(text, /累|疲惫|精力不足|没精神/)) add("current.wellbeing.energy", "low", "high");
  if (has(text, /情绪/)) add("future.capabilities.emotional_context", "把明确表达的情绪作为阶段判断上下文", "medium");
  if (has(text, /很忙|事情很多|项目很多/) && !has(text, /第一优先|最重要|本周重点/))
    questions.push({ question_key: "current_priority", question_text: "现在最不能延误的一件事是什么？", why_it_matters: "用于区分真实优先级和普通记录。" });
  if (has(text, /家里|家人|旅行|出去玩/) && !has(text, /日期|时间|地点/))
    questions.push({ question_key: "life_schedule_constraint", question_text: "生活安排的日期或时间窗口是什么？", why_it_matters: "用于识别工作与生活的时间冲突。" });

  return { signals, questions: questions.slice(0, 3), extraction: { method: "bounded_rules", confidence: signals.length ? "medium" : "low" } };
}
