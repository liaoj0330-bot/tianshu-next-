function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s（）()·/_-]+/g, "");
}

export function matchCreatorProject(message, portfolio) {
  const text = normalize(message);
  if (!text) throw new Error("message is required");
  if (!Array.isArray(portfolio)) throw new Error("portfolio is required");
  const matches = portfolio.filter((project) => {
    const key = normalize(project.project_key);
    const name = normalize(project.display_name);
    return (key.length >= 3 && text.includes(key)) || (name.length >= 2 && text.includes(name));
  });
  if (matches.length !== 1) {
    return {
      status: matches.length > 1 ? "ambiguous" : "unresolved",
      execution_allowed: false,
      confidence: matches.length > 1 ? "low" : "none",
      candidates: matches.map(({ project_key, display_name }) => ({ project_key, display_name })),
      reason: matches.length > 1 ? "多个 SQLite 项目档案被明确提及，需要奈奈确认归属。" : "未找到项目键或正式项目名的明确证据，不进行关键词猜测。",
    };
  }
  const project = matches[0];
  const blocked = project.execution_policy === "no_access";
  return {
    status: blocked ? "blocked" : "matched",
    execution_allowed: false,
    confidence: "high",
    project: { project_key: project.project_key, display_name: project.display_name, execution_policy: project.execution_policy, status: project.status },
    reason: blocked ? "命中 SQLite 正式项目档案，但执行策略为 no_access。" : "通过 SQLite 正式项目键或完整项目名匹配；仍需受控计划和确认后才能执行。",
  };
}