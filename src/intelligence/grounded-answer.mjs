function parse(value, fallback = null) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}

export function composeGroundedAnswer(db, message, { subject_id = "creator" } = {}) {
  const subject = db.prepare(`SELECT s.state_json, s.version, s.created_at FROM state_snapshots s JOIN state_subjects x ON x.current_snapshot_id=s.snapshot_id WHERE x.subject_id=?`).get(subject_id);
  if (!subject) return { status: "needs_clarification", question: "我还没有你的正式当前状态。你希望我先以哪些长期目标和当前项目作为判断基线？", completed: false, evidence: [] };
  const state = parse(subject.state_json, { stable: {}, current: {}, future: {} });
  const projects = db.prepare(`SELECT p.project_key,p.display_name,p.execution_policy,p.status,COALESCE(a.score,p.baseline_priority*20) score,a.priority_band,a.confidence,a.status assessment_status FROM creator_project_profiles p LEFT JOIN creator_priority_assessments a ON a.project_key=p.project_key AND a.status IN ('candidate','confirmed') ORDER BY score DESC,p.project_key`).all();
  const eligible = projects.filter((item) => item.execution_policy !== "no_access");
  const top = eligible[0];
  const energy = state.current?.wellbeing?.energy;
  const asksPriority = /(最应该|优先|先推进|哪一件|哪个.*优先|怎么安排)/.test(message);
  const asksWhy = /为什么/.test(message);
  if (!asksPriority && !asksWhy) return { status: "needs_clarification", question: "你希望我重点判断优先级、风险，还是下一步行动？", completed: false, evidence: [{ type: "state_snapshot", version: subject.version }] };
  if (!top) return { status: "needs_clarification", question: "当前没有可执行项目。你希望先确认哪个项目进入活跃状态？", completed: false, evidence: [{ type: "state_snapshot", version: subject.version }] };
  const assessmentState = top.assessment_status === "confirmed" ? "已确认" : "仍待你确认";
  const judgment = energy === "low"
    ? `今天建议只保留一个主任务：先推进「${top.display_name}」，并主动降低并行工作量。`
    : `当前建议优先推进「${top.display_name}」，不要同时展开多个低优先级事项。`;
  return {
    status: "answered",
    completed: true,
    judgment,
    rationale: [
      `该项目当前量化分数为 ${top.score}，在可执行项目中最高（${assessmentState}）。`,
      energy === "low" ? "正式状态显示当前精力偏低，因此判断加入了降低并行度的约束。" : "当前没有已确认的低精力约束。",
      "受保护或 no_access 项目已排除在建议执行范围之外。",
    ],
    uncertainty: top.assessment_status === "confirmed" ? [] : ["项目分数仍是候选判断，奈奈尚未最终确认。"],
    next_action: `先明确「${top.display_name}」今天唯一需要交付的结果；如需执行，再形成计划卡。`,
    requires_confirmation: false,
    evidence: [
      { type: "state_snapshot", subject_id, version: subject.version, created_at: subject.created_at },
      { type: "project_priority", project_key: top.project_key, score: top.score, assessment_status: top.assessment_status ?? "baseline" },
    ],
  };
}