import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { canonicalJson, sha256 } from "../core/store.mjs";
import { listAdvisoryRecommendations } from "../advisory/external-advice.mjs";
import {
  VISIBLE_WORKSPACES,
  buildCreatorModelReadModel,
  buildWorkspaceIndexReadModel,
  buildWorkspaceReadModel,
  listJudgmentReadModel,
} from "./read-models.mjs";

const GENERATOR_VERSION = "obsidian-read-model/2";
const MANIFEST_PATH = ".tianshu-read-model.json";

const BASE_PAGES = Object.freeze({
  home: "00_从这里开始_天枢工作台.md",
  creator: "10_奈奈/00_奈奈模型.md",
  projects: "20_项目/00_项目总览.md",
  life: "30_生活与关系/00_生活与关系.md",
  lifeDetail: "30_生活与关系/10_生活.md",
  relationships: "30_生活与关系/20_关系.md",
  knowledge: "40_知识与判断/00_知识与判断.md",
  judgments: "40_知识与判断/10_判断账本.md",
  evidence: "40_知识与判断/20_证据索引.md",
  advisory: "40_知识与判断/30_外部建议审议.md",
  evolution: "50_进化/00_进化总览.md",
  evolutionCandidates: "50_进化/10_经验候选.md",
  evolutionActive: "50_进化/20_已确认经验.md",
  evolutionCounterexamples: "50_进化/30_反例与回滚.md",
  activity: "60_活动/00_活动记录.md",
  activityRunning: "60_活动/10_执行中.md",
  activityAcceptance: "60_活动/20_待验收.md",
  activityFailures: "60_活动/30_失败与恢复.md",
  activityAudit: "60_活动/40_审计记录.md",
  system: "99_系统/00_系统说明.md",
  boundaries: "99_系统/10_使用边界.md",
  health: "99_系统/20_同步与健康.md",
  generated: "99_系统/90_生成清单.md",
});

function withoutVolatileFields(value) {
  if (Array.isArray(value)) return value.map(withoutVolatileFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "generated_at")
    .map(([key, item]) => [key, withoutVolatileFields(item)]));
}

function yamlText(value) {
  return JSON.stringify(String(value));
}

function frontMatter({ title, sourceModel, sourceFingerprint }) {
  return [
    "---",
    `title: ${yamlText(title)}`,
    "type: sqlite-read-model",
    "state_authority: sqlite",
    "generated_by: tianshu-next",
    `generator_version: ${yamlText(GENERATOR_VERSION)}`,
    `source_model: ${yamlText(sourceModel)}`,
    `source_fingerprint: ${sourceFingerprint}`,
    "---",
    "",
  ].join("\n");
}

function jsonBlock(value) {
  return `\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function textValue(value) {
  if (value == null || value === "") return "暂无";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  const preferred = value.summary ?? value.title ?? value.action ?? value.claim
    ?? value.question ?? value.reason ?? value.value;
  const text = preferred == null ? JSON.stringify(value) : String(preferred);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function bullets(items, render, empty = "- 暂无") {
  return items?.length ? items.map((item, index) => `- ${render(item, index)}`) : [empty];
}

function flattenObject(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [[prefix, value]] : [];
  }
  return Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return item && typeof item === "object" && !Array.isArray(item)
      ? flattenObject(item, path)
      : [[path, item]];
  });
}

function auditDetails(label, value) {
  return [
    "<details>",
    `<summary>${label}</summary>`,
    "",
    jsonBlock(value).trim(),
    "",
    "</details>",
  ].join("\n");
}

function page({ title, sourceModel, sourceFingerprint, body }) {
  return `${frontMatter({ title, sourceModel, sourceFingerprint })}# ${title}\n\n${body.trim()}\n`;
}

function fileStem(filePath) {
  return filePath.replace(/\.md$/u, "");
}

function link(filePath, label) {
  return `[[${fileStem(filePath)}|${label}]]`;
}

function safeProjectName(value) {
  const cleaned = String(value ?? "project")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .replace(/\s+/gu, "_")
    .replace(/\.+$/gu, "")
    .slice(0, 64) || "project";
  return `${cleaned}_${sha256(String(value ?? "project")).slice(0, 8)}`;
}

function projectPages(projectKey) {
  const root = `20_项目/项目_${safeProjectName(projectKey)}`;
  return {
    home: `${root}/00_项目首页.md`,
    current: `${root}/10_当前状态.md`,
    timeline: `${root}/20_时间线.md`,
    evidence: `${root}/30_判断与证据.md`,
  };
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function judgmentLine(judgment) {
  const action = textValue(judgment.recommendation);
  return `**${judgment.question}** · ${judgment.status} · 建议：${action}`;
}

function renderHome(models, sourceFingerprint) {
  const today = models.workspaces.today;
  const confirmations = today.confirmations ?? [];
  const focus = today.focus;
  return page({
    title: "天枢工作台",
    sourceModel: "workspace:today",
    sourceFingerprint,
    body: [
      "> 奈奈每天只从这里开始。这里展示当前焦点、需要你决定的事项和正在发生的工作，不承担机器状态写入。",
      "",
      "## 现在最重要",
      "",
      ...(focus ? [
        `**${focus.title}**`,
        "",
        `- 为什么：${focus.reason}`,
        `- 下一步：${focus.next_action}`,
      ] : ["- 暂无足够证据形成唯一焦点。"]),
      "",
      "## 等你决定",
      "",
      ...bullets(confirmations, (item) => `**${item.title}** · ${item.summary}`),
      "",
      "## 运行坐标",
      "",
      `- 当前项目：${count(models.workspaces.projects.projects)}`,
      `- 待确认：${confirmations.length}`,
      `- 执行中：${today.execution_summary?.running ?? 0}`,
      `- 待独立验证：${today.execution_summary?.awaiting_review ?? 0}`,
      `- 待奈奈最终验收：${today.execution_summary?.awaiting_creator_decision ?? 0}`,
      "",
      "## 工作区",
      "",
      `- ${link(BASE_PAGES.creator, "奈奈")}`,
      `- ${link(BASE_PAGES.projects, "项目")}`,
      `- ${link(BASE_PAGES.life, "生活与关系")}`,
      `- ${link(BASE_PAGES.knowledge, "知识与判断")}`,
      `- ${link(BASE_PAGES.evolution, "进化")}`,
      `- ${link(BASE_PAGES.activity, "活动")}`,
      `- ${link(BASE_PAGES.system, "系统")}`,
      "",
      "## 入口边界",
      "",
      "- AgentHub：奈奈的自然语言与异步协作入口，负责提交、通知和呈现，不拥有正式状态。",
      "- SQLite：唯一机器状态真相源，保存确认、执行、验证、验收和经验版本。",
      "- Obsidian：奈奈可读、可确认的知识工作台；生成页可删除重建，编辑不会反向改写状态。",
      "",
      "## 旧目录如何收敛",
      "",
      "- `00_入口导航` 与根入口合并，本页成为唯一日常入口。",
      "- `04_判断资产卡库` 进入判断账本，不再手工维护孤立卡片。",
      "- `06_项目记忆层` 与 `30_项目推进区` 合并进每个项目的一份状态、时间线和证据。",
      "- `07_资产索引层` 进入证据索引。",
      "- `20_长期工作区` 按内容归入项目、生活、关系、知识或进化。",
      "- `90_待处理` 变为本页的动态待确认视图。",
      "- `98_历史归档` 变为活动与审计的时间筛选，不再手工搬文件。",
    ].join("\n"),
  });
}

function renderCreator(models, sourceFingerprint) {
  const snapshot = models.creator.state?.current_snapshot;
  const fields = flattenObject(snapshot?.state ?? {});
  return page({
    title: "奈奈模型",
    sourceModel: "creator_model",
    sourceFingerprint,
    body: [
      "这里只呈现已确认的奈奈状态、待确认变化和系统仍需追问的问题。候选内容不会自动变成你的身份或长期记忆。",
      "",
      "## 已确认模型",
      "",
      ...(snapshot ? [
        `- 版本：${snapshot.version}`,
        `- 生效时间：${snapshot.created_at}`,
        ...bullets(fields, ([path, value]) => `\`${path}\`：${textValue(value)}`),
      ] : ["- 尚未建立已确认模型。"]),
      "",
      "## 待确认变化",
      "",
      ...bullets(models.creator.pending_state_updates, (item) => `状态候选 \`${item.cycle_id}\` · ${item.observed_at}`),
      "",
      "## 仍需回答",
      "",
      ...bullets(models.creator.pending_questions, (item) => `**${item.question_text}** · ${item.why_it_matters}`),
    ].join("\n"),
  });
}

function renderProjects(models, sourceFingerprint, projectLinks) {
  const projectModel = models.workspaces.projects;
  return page({
    title: "项目总览",
    sourceModel: "workspace:projects",
    sourceFingerprint,
    body: [
      "一个项目只保留一份正式状态。项目记忆、推进状态、判断和证据都在项目内部呈现，不再分散为多个顶层目录。",
      "",
      `- 可见项目：${projectLinks.length}`,
      `- 受保护项目：${projectModel.protected_project_count ?? 0}（仅显示数量）`,
      "",
      "## 项目索引",
      "",
      ...bullets(projectLinks, ({ pages, project }) => `${link(pages.home, project.display_name ?? project.project_key)} · ${project.status ?? "unknown"}`),
      "",
      "## 最近项目输入",
      "",
      ...bullets(projectModel.recent_intakes, (item) => `${item.message ?? "无文本"} · ${item.assignment?.decision_state ?? item.status}`),
    ].join("\n"),
  });
}

function renderProjectHome(project, pages, sourceFingerprint) {
  const title = project.display_name ?? project.project_key;
  return page({
    title,
    sourceModel: `project:${project.project_key}`,
    sourceFingerprint,
    body: [
      `- 项目标识：\`${project.project_key}\``,
      `- 当前状态：${project.status ?? "unknown"}`,
      `- 优先级：${project.priority_label ?? project.lane ?? "尚未评估"}`,
      `- 证据状态：${project.evidence_state ?? "unknown"}`,
      "",
      "## 项目内导航",
      "",
      `- ${link(pages.current, "当前状态")}`,
      `- ${link(pages.timeline, "时间线")}`,
      `- ${link(pages.evidence, "判断与证据")}`,
      "",
      `返回 ${link(BASE_PAGES.projects, "项目总览")}`,
    ].join("\n"),
  });
}

function renderProjectCurrent(project, pages, sourceFingerprint) {
  const states = Object.entries(project.current_state ?? {});
  return page({
    title: `${project.display_name ?? project.project_key} · 当前状态`,
    sourceModel: `project-state:${project.project_key}`,
    sourceFingerprint,
    body: [
      "此页只展示 SQLite 中的正式项目状态。待确认变化留在时间线，不会提前覆盖当前值。",
      "",
      ...bullets(states, ([key, item]) => `**${key}**：${textValue(item.value)} · 更新于 ${item.updated_at}`),
      "",
      `返回 ${link(pages.home, "项目首页")}`,
    ].join("\n"),
  });
}

function renderProjectTimeline(project, pages, timeline, sourceFingerprint) {
  return page({
    title: `${project.display_name ?? project.project_key} · 时间线`,
    sourceModel: `project-timeline:${project.project_key}`,
    sourceFingerprint,
    body: [
      "时间线承担追溯，不承担第二份当前状态。每条变化保留候选、决定和时间。",
      "",
      ...bullets(timeline, (item) => `**${item.summary}** · ${item.status} · ${item.created_at}`),
      "",
      `返回 ${link(pages.home, "项目首页")}`,
    ].join("\n"),
  });
}

function renderProjectEvidence(project, pages, judgments, sourceFingerprint) {
  const evidence = [
    ...judgments.flatMap((item) => item.evidence ?? []),
    ...(project.pending_changes ?? []).flatMap((item) => item.evidence ?? []),
  ];
  return page({
    title: `${project.display_name ?? project.project_key} · 判断与证据`,
    sourceModel: `project-evidence:${project.project_key}`,
    sourceFingerprint,
    body: [
      "判断、事实、推断和证据必须可区分。这里只展示与该项目明确关联的记录。",
      "",
      "## 判断",
      "",
      ...bullets(judgments, judgmentLine),
      "",
      "## 证据",
      "",
      ...bullets(evidence, (item) => textValue(item)),
      "",
      `返回 ${link(pages.home, "项目首页")}`,
    ].join("\n"),
  });
}

function renderDomainPage({ title, introduction, model, sourceModel, sourceFingerprint }) {
  return page({
    title,
    sourceModel,
    sourceFingerprint,
    body: [
      introduction,
      "",
      "## 最近输入",
      "",
      ...bullets(model.recent_intakes, (item) => `${item.message ?? "无文本"} · ${item.assignment?.decision_state ?? item.status}`),
      "",
      "## 判断",
      "",
      ...bullets(model.judgments, judgmentLine),
    ].join("\n"),
  });
}

function renderJudgmentLedger(models, sourceFingerprint) {
  return page({
    title: "判断账本",
    sourceModel: "judgments",
    sourceFingerprint,
    body: [
      "这里是跨项目、生活、关系和知识的判断记录。接受、纠正、拒绝、延后和忽略都会保留。",
      "",
      ...bullets(models.judgments, judgmentLine),
    ].join("\n"),
  });
}

function renderEvidenceIndex(models, sourceFingerprint) {
  const entities = models.workspaces.knowledge.entities ?? [];
  return page({
    title: "证据索引",
    sourceModel: "workspace:knowledge",
    sourceFingerprint,
    body: [
      "证据按来源和有效状态进入索引；受保护实体不会出现在此镜像。",
      "",
      ...bullets(entities, (entity) => `**${entity.display_name}** · ${entity.entity_type} · ${count(entity.evidence)} 条证据 · ${entity.status}`),
    ].join("\n"),
  });
}

function renderAdvisory(models, sourceFingerprint) {
  return page({
    title: "外部建议审议",
    sourceModel: "advisory_recommendations",
    sourceFingerprint,
    body: [
      "吴老师和其他外部来源只提供建议。只有奈奈作出的采用、适配、暂缓或拒绝决定，才能继续进入正式变更流程。",
      "",
      ...bullets(models.advisory, (item) => `**${item.topic}** · ${item.status} · 建议处置 ${item.proposed_disposition} · ${item.assessment}`),
    ].join("\n"),
  });
}

function renderEvolutionPage({ title, introduction, items, render, sourceModel, sourceFingerprint }) {
  return page({
    title,
    sourceModel,
    sourceFingerprint,
    body: [introduction, "", ...bullets(items, render)].join("\n"),
  });
}

function renderActivityPage({ title, introduction, goals, sourceModel, sourceFingerprint }) {
  return page({
    title,
    sourceModel,
    sourceFingerprint,
    body: [
      introduction,
      "",
      ...bullets(goals, (goal) => {
        const states = goal.plans.flatMap((plan) => [plan.plan_status, plan.task_status, plan.run_status]).filter(Boolean).join(" / ");
        return `**${goal.contract?.objective ?? goal.goal_id}** · ${goal.status}${states ? ` · ${states}` : ""}`;
      }),
    ].join("\n"),
  });
}

function buildSourceModels(db) {
  return withoutVolatileFields({
    creator: buildCreatorModelReadModel(db),
    index: buildWorkspaceIndexReadModel(db),
    judgments: listJudgmentReadModel(db, { limit: 200 }).items,
    workspaces: Object.fromEntries(VISIBLE_WORKSPACES.map((workspace) => [
      workspace,
      buildWorkspaceReadModel(db, workspace),
    ])),
    advisory: listAdvisoryRecommendations(db),
  });
}

function buildFiles(models, sourceFingerprint) {
  const files = new Map();
  const projects = models.workspaces.projects.projects ?? [];
  const projectLinks = projects.map((project) => ({ project, pages: projectPages(project.project_key) }));
  const evolution = models.workspaces.evolution;
  const activity = models.workspaces.activity;
  const experiences = evolution.experiences ?? [];
  const pendingExperiences = experiences.filter((item) => item.pending_version);
  const activeExperiences = experiences.filter((item) => item.status === "active" && item.current_version);
  const counterexamples = experiences.flatMap((item) => (item.counterexamples ?? []).map((counterexample) => ({
    ...counterexample,
    experience_title: item.title,
  })));
  const goals = activity.goals ?? [];
  const goalHasState = (goal, pattern) => goal.plans.some((plan) => [
    plan.plan_status,
    plan.task_status,
    plan.run_status,
  ].some((state) => pattern.test(String(state ?? ""))));
  const runningGoals = goals.filter((goal) => goalHasState(goal, /queued|running|awaiting_verification/u));
  const acceptanceGoals = goals.filter((goal) => goalHasState(goal, /awaiting_creator/u));
  const failedGoals = goals.filter((goal) => goalHasState(goal, /failed|cancelled|timed_out|blocked/u));

  files.set(BASE_PAGES.home, renderHome(models, sourceFingerprint));
  files.set(BASE_PAGES.creator, renderCreator(models, sourceFingerprint));
  files.set(BASE_PAGES.projects, renderProjects(models, sourceFingerprint, projectLinks));
  for (const { project, pages } of projectLinks) {
    const timeline = (models.workspaces.today.project_timeline ?? [])
      .filter((item) => item.project_key === project.project_key);
    const judgments = models.judgments.filter(
      (item) => item.workspace === "projects" && item.subject_id === project.project_key,
    );
    files.set(pages.home, renderProjectHome(project, pages, sourceFingerprint));
    files.set(pages.current, renderProjectCurrent(project, pages, sourceFingerprint));
    files.set(pages.timeline, renderProjectTimeline(project, pages, timeline, sourceFingerprint));
    files.set(pages.evidence, renderProjectEvidence(project, pages, judgments, sourceFingerprint));
  }
  files.set(BASE_PAGES.life, page({
    title: "生活与关系",
    sourceModel: "workspace:life+relationships",
    sourceFingerprint,
    body: [
      "生活与关系共享现实上下文，但保持两套分类和权限，避免项目逻辑吞没人的感受、健康与沟通边界。",
      "",
      `- ${link(BASE_PAGES.lifeDetail, "生活")}`,
      `- ${link(BASE_PAGES.relationships, "关系")}`,
    ].join("\n"),
  }));
  files.set(BASE_PAGES.lifeDetail, renderDomainPage({
    title: "生活",
    introduction: "健康、精力、日程约束和个人承诺在这里呈现。",
    model: models.workspaces.life,
    sourceModel: "workspace:life",
    sourceFingerprint,
  }));
  files.set(BASE_PAGES.relationships, renderDomainPage({
    title: "关系",
    introduction: "关系上下文用于提醒和沟通草稿；未经奈奈授权不会自动对外发送。",
    model: models.workspaces.relationships,
    sourceModel: "workspace:relationships",
    sourceFingerprint,
  }));
  files.set(BASE_PAGES.knowledge, page({
    title: "知识与判断",
    sourceModel: "workspace:knowledge",
    sourceFingerprint,
    body: [
      "知识不是为了囤积，而是为了给判断提供来源、有效性和反证。",
      "",
      `- ${link(BASE_PAGES.judgments, "判断账本")}`,
      `- ${link(BASE_PAGES.evidence, "证据索引")}`,
      `- ${link(BASE_PAGES.advisory, "外部建议审议")}`,
    ].join("\n"),
  }));
  files.set(BASE_PAGES.judgments, renderJudgmentLedger(models, sourceFingerprint));
  files.set(BASE_PAGES.evidence, renderEvidenceIndex(models, sourceFingerprint));
  files.set(BASE_PAGES.advisory, renderAdvisory(models, sourceFingerprint));
  files.set(BASE_PAGES.evolution, page({
    title: "进化总览",
    sourceModel: "workspace:evolution",
    sourceFingerprint,
    body: [
      "经验先成为候选，经过奈奈确认、范围限定和反例检查后才影响未来判断。",
      "",
      `- ${link(BASE_PAGES.evolutionCandidates, "经验候选")} · ${pendingExperiences.length + count(evolution.memory_candidates) + count(evolution.evolution_candidates)}`,
      `- ${link(BASE_PAGES.evolutionActive, "已确认经验")} · ${activeExperiences.length}`,
      `- ${link(BASE_PAGES.evolutionCounterexamples, "反例与回滚")} · ${counterexamples.length}`,
    ].join("\n"),
  }));
  files.set(BASE_PAGES.evolutionCandidates, renderEvolutionPage({
    title: "经验候选",
    introduction: "候选不会自动生效。这里同时展示待确认经验版本、记忆候选和系统进化候选。",
    items: [
      ...pendingExperiences.map((item) => ({ title: item.title, kind: `经验 v${item.pending_version.version}` })),
      ...(evolution.memory_candidates ?? []).map((item) => ({ title: item.statement, kind: "记忆候选" })),
      ...(evolution.evolution_candidates ?? []).map((item) => ({ title: item.title, kind: item.kind })),
    ],
    render: (item) => `**${item.title}** · ${item.kind}`,
    sourceModel: "workspace:evolution:candidates",
    sourceFingerprint,
  }));
  files.set(BASE_PAGES.evolutionActive, renderEvolutionPage({
    title: "已确认经验",
    introduction: "只有当前有效版本能被后续判断引用，并且引用必须披露。",
    items: activeExperiences,
    render: (item) => `**${item.title} v${item.current_version.version}** · 使用 ${item.usage_summary.total} 次 · 有帮助 ${item.usage_summary.helpful} 次 · 有害 ${item.usage_summary.harmful} 次`,
    sourceModel: "workspace:evolution:active",
    sourceFingerprint,
  }));
  files.set(BASE_PAGES.evolutionCounterexamples, renderEvolutionPage({
    title: "反例与回滚",
    introduction: "确认反例会停止受影响经验继续生效；回滚和失效都保留完整生命周期证据。",
    items: counterexamples,
    render: (item) => `**${item.experience_title}** · ${item.status} · ${textValue(item.observation)}`,
    sourceModel: "workspace:evolution:counterexamples",
    sourceFingerprint,
  }));
  files.set(BASE_PAGES.activity, page({
    title: "活动记录",
    sourceModel: "workspace:activity",
    sourceFingerprint,
    body: [
      "活动是执行、验证、失败和恢复的可追溯记录，不是第二套项目状态。",
      "",
      `- ${link(BASE_PAGES.activityRunning, "执行中")} · ${runningGoals.length}`,
      `- ${link(BASE_PAGES.activityAcceptance, "待验收")} · ${acceptanceGoals.length}`,
      `- ${link(BASE_PAGES.activityFailures, "失败与恢复")} · ${failedGoals.length}`,
      `- ${link(BASE_PAGES.activityAudit, "审计记录")} · ${count(activity.events)}`,
    ].join("\n"),
  }));
  files.set(BASE_PAGES.activityRunning, renderActivityPage({
    title: "执行中",
    introduction: "仅展示已经进入队列、执行或独立验证的目标。",
    goals: runningGoals,
    sourceModel: "workspace:activity:running",
    sourceFingerprint,
  }));
  files.set(BASE_PAGES.activityAcceptance, renderActivityPage({
    title: "待验收",
    introduction: "验证通过不等于完成；这里等待奈奈最终接受或拒绝。",
    goals: acceptanceGoals,
    sourceModel: "workspace:activity:acceptance",
    sourceFingerprint,
  }));
  files.set(BASE_PAGES.activityFailures, renderActivityPage({
    title: "失败与恢复",
    introduction: "失败、取消、超时和阻塞都必须保留，并提供可追溯恢复路径。",
    goals: failedGoals,
    sourceModel: "workspace:activity:failures",
    sourceFingerprint,
  }));
  files.set(BASE_PAGES.activityAudit, page({
    title: "审计记录",
    sourceModel: "workspace:activity:events",
    sourceFingerprint,
    body: [
      "审计记录按时间追加，不作为日常入口。",
      "",
      ...bullets(activity.events, (item) => `\`${item.created_at}\` · ${item.event_type} · ${item.entity_type}/${item.entity_id}`),
    ].join("\n"),
  }));
  files.set(BASE_PAGES.system, page({
    title: "系统说明",
    sourceModel: "authority+workspace_index",
    sourceFingerprint,
    body: [
      "AgentHub 是统一交互和异步协作入口；天枢负责判断与治理；SQLite 是唯一机器状态源；Obsidian 是可重建读模型。",
      "",
      `- ${link(BASE_PAGES.boundaries, "使用边界")}`,
      `- ${link(BASE_PAGES.health, "同步与健康")}`,
      `- ${link(BASE_PAGES.generated, "生成清单")}`,
    ].join("\n"),
  }));
  files.set(BASE_PAGES.boundaries, page({
    title: "使用边界",
    sourceModel: "authority",
    sourceFingerprint,
    body: [
      "奈奈拥有目标、正式状态、执行批准、最终验收和经验提升权。AgentHub 只能提交与呈现，Executor 只能报告产出，Verifier 只能验证证据。",
      "",
      ...bullets(models.creator.authority.policies, (item) => `**${item.principal_id} / ${item.capability}** · ${item.effect} · ${item.rationale}`),
    ].join("\n"),
  }));
  files.set(BASE_PAGES.health, page({
    title: "同步与健康",
    sourceModel: "workspace_index",
    sourceFingerprint,
    body: [
      `- 状态真相源：${models.index.state_authority}`,
      `- 来源指纹：\`${sourceFingerprint}\``,
      `- 待工作区确认：${models.index.pending_confirmation_count}`,
      "",
      ...models.index.items.map((item) => `- **${item.label}**：${item.assignment_count} 条输入，${item.judgment_count} 条判断`),
      "",
      auditDetails("查看完整工作区索引", models.index),
    ].join("\n"),
  }));
  return files;
}

function resolvedChild(root, relativePath) {
  const rootPath = resolve(root);
  const target = resolve(rootPath, relativePath);
  const prefix = `${rootPath}${sep}`.toLocaleLowerCase();
  if (!target.toLocaleLowerCase().startsWith(prefix)) throw new Error(`generated path escapes output root: ${relativePath}`);
  return target;
}

function atomicWrite(target, content) {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  writeFileSync(temp, content, "utf8");
  if (existsSync(target)) rmSync(target, { force: true });
  renameSync(temp, target);
}

function readPreviousManifest(outputRoot) {
  const path = resolvedChild(outputRoot, MANIFEST_PATH);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return String(value?.generator_version ?? "").startsWith("obsidian-read-model/")
      && Array.isArray(value.files) ? value : null;
  } catch {
    return null;
  }
}

function pruneUnchangedStaleFiles(outputRoot, previousManifest, currentPaths) {
  for (const file of previousManifest?.files ?? []) {
    if (currentPaths.has(file.path)) continue;
    const target = resolvedChild(outputRoot, file.path);
    if (!existsSync(target) || !statSync(target).isFile()) continue;
    if (sha256(readFileSync(target)) === file.sha256) rmSync(target, { force: true });
  }
}

function generatedIndex(manifest, sourceFingerprint) {
  return page({
    title: "生成清单",
    sourceModel: "obsidian_manifest",
    sourceFingerprint,
    body: [
      `- 生成器版本：\`${manifest.generator_version}\``,
      `- 来源指纹：\`${manifest.source_fingerprint}\``,
      `- 生成文件数：${manifest.files.length + 1}`,
      "",
      "## 文件",
      "",
      ...manifest.files.map((file) => `- \`${file.path}\` · \`${file.sha256.slice(0, 12)}\` · ${file.size_bytes} bytes`),
      "",
      "清单不包含自身的哈希，避免自引用。根目录的 JSON 清单供机器校验。",
    ].join("\n"),
  });
}

export function buildObsidianReadModel(db, outputDirectory) {
  if (!outputDirectory) throw new Error("outputDirectory is required");
  const outputRoot = resolve(outputDirectory);
  mkdirSync(outputRoot, { recursive: true });
  const previousManifest = readPreviousManifest(outputRoot);
  const models = buildSourceModels(db);
  const sourceFingerprint = sha256(canonicalJson(models));
  const files = buildFiles(models, sourceFingerprint);

  const preliminaryManifest = {
    schema_version: 1,
    generator_version: GENERATOR_VERSION,
    state_authority: "sqlite",
    source_fingerprint: sourceFingerprint,
    files: [...files.entries()].map(([path, content]) => ({
      path,
      sha256: sha256(content),
      size_bytes: Buffer.byteLength(content, "utf8"),
    })).sort((a, b) => a.path.localeCompare(b.path, "zh-CN")),
  };
  files.set(BASE_PAGES.generated, generatedIndex(preliminaryManifest, sourceFingerprint));
  const manifest = {
    ...preliminaryManifest,
    files: [...files.entries()].map(([path, content]) => ({
      path,
      sha256: sha256(content),
      size_bytes: Buffer.byteLength(content, "utf8"),
    })).sort((a, b) => a.path.localeCompare(b.path, "zh-CN")),
  };

  const currentPaths = new Set(files.keys());
  pruneUnchangedStaleFiles(outputRoot, previousManifest, currentPaths);
  for (const [relativePath, content] of files) atomicWrite(resolvedChild(outputRoot, relativePath), content);
  atomicWrite(resolvedChild(outputRoot, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    output_directory: outputRoot,
    state_authority: "sqlite",
    source_fingerprint: sourceFingerprint,
    manifest_path: resolvedChild(outputRoot, MANIFEST_PATH),
    files: manifest.files,
  };
}

export { BASE_PAGES, GENERATOR_VERSION, MANIFEST_PATH };
