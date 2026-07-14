const has = (text, pattern) => pattern.test(text);

export function extractCreatorSignals(text) {
  if (!text || typeof text !== "string") throw new Error("creator text is required");
  const signals = [];
  const questions = [];
  const add = (path, value, confidence = "medium", source_type = "creator_explicit") =>
    signals.push({ path, operation: "set", value, confidence, source_type });

  if (has(text, /高校|产教融合|高校教育/)) add("stable.mission", "高校AI教育体系与产教融合", "high");
  if (has(text, /个人IP|自己的IP/)) add("stable.strategic_directions.personal_ip", true, "high");
  if (has(text, /Teacher PPT|教师.*PPT|教师备课/)) add("current.projects.teacher_ppt", "教师AI演示文稿/备课产品", "high");
  if (has(text, /天枢|言出法随/)) add("current.projects.tianshu", "个人AI工作系统与主动陪伴系统", "high");
  if (has(text, /API|公司.*项目|辅助项目/)) add("current.projects.company_auxiliary", "公司辅助业务项目", "medium");
  if (has(text, /澳大利亚|澳洲/)) add("current.events.australia_cooperation", "澳大利亚合作事项出现新进展", "medium");
  if (has(text, /秘书长|政府.*推进|成立.*公司/)) add("current.events.australia_cooperation.level_change", "关键合作方与政府推进角色发生变化", "medium");
  if (has(text, /手机|硬件|摄像头|睡眠/)) add("future.capabilities.device_companion", "手机与硬件作为持续输入入口", "medium");
  if (has(text, /每天.*晚上|定时|每天.*总结/)) add("future.capabilities.daily_checkin", "通过定时主动询问建立每日状态更新习惯", "high");
  if (has(text, /情绪/)) add("future.capabilities.emotional_context", "把明确表达的情绪作为阶段判断上下文", "medium");

  if (has(text, /澳大利亚|澳洲/) && !has(text, /我.*角色|负责|时间|股权|责任/))
    questions.push({ question_key: "australia_role_and_decision", question_text: "这次合作里，你目前明确承担的角色和最需要做的决定是什么？", why_it_matters: "否则只能确认事件升级，不能可靠调整你的优先级。" });
  if (has(text, /很忙|事情很多|项目很多/) && !has(text, /第一优先|最重要|本周重点/))
    questions.push({ question_key: "current_priority", question_text: "现在最不能延误的一件事是什么？", why_it_matters: "用于区分真实优先级和普通记录。" });
  if (has(text, /家里|家人|旅行|出去玩/) && !has(text, /日期|时间|地点/))
    questions.push({ question_key: "life_schedule_constraint", question_text: "生活安排的日期或时间窗口是什么？", why_it_matters: "用于识别工作与生活的时间冲突。" });

  return { signals, questions: questions.slice(0, 3), extraction: { method: "bounded_rules", confidence: signals.length ? "medium" : "low" } };
}
