import { canonicalJson } from "../core/store.mjs";
import { decideProjectChange, getProjectCurrentState, proposeProjectChange } from "./project-changes.mjs";
import { assessCreatorProject, getCreatorPortfolio, upsertCreatorProjectBaseline } from "./project-priority.mjs";

const REGISTERED_AT = "2026-07-17";
const BASELINE_SOURCE = Object.freeze({
  kind: "creator_confirmation",
  reference: "AgentHub conversation: add AI quant and crystal DIY as secondary projects",
  version: `${REGISTERED_AT}-v1`,
});

const ASSESSMENT_FACTORS = Object.freeze({
  mission_alignment: 3,
  system_asset_leverage: 3,
  time_window: 1,
  evidence_quality: 2,
  dependency_urgency: 1,
  resource_pressure: 3,
});

export const INCUBATION_PROJECTS = Object.freeze([
  {
    project_key: "ai_quant_research",
    display_name: "AI 量化系统",
    lane: "incubation",
    baseline_priority: 2,
    execution_policy: "read_only",
    status: "waiting",
    evidence: [
      "正式收到 11 条量化素材，数量、顺序和来源已保留",
      "创造者确认：纳入项目体系，但不是当前主航道",
      "硬边界：禁止自动交易、资金操作和直接实盘",
    ],
    source_reference: "intake_cd0519adddce4ae5b4f2",
    states: {
      stage: "资料已登记，等待证据核验与需求澄清",
      priority: {
        lane: "孵化区",
        level: "保持关注",
        main_track: false,
        rationale: "有研究价值，但收益宣传、数据口径和可复现性尚未核验。",
      },
      risk: {
        level: "high",
        facts: ["已登记 11 条素材"],
        unknowns: ["宣传收益是否真实", "策略能否复现", "数据与回测是否存在偏差"],
        prohibited_actions: ["自动交易", "资金操作", "连接券商或交易账户", "直接执行实盘"],
      },
      note: {
        first_outcome: "形成素材证据矩阵、需求定义、风险边界和最小可行研究方案",
        next_action: "有空时逐条核验 11 条素材，先分清事实、宣传、推断和未知项",
        next_when_resumed: "逐条核验来源，区分事实、宣传、推断和未知项",
        execution_started: false,
      },
    },
  },
  {
    project_key: "crystal_diy_system",
    display_name: "水晶 DIY 系统",
    lane: "incubation",
    baseline_priority: 2,
    execution_policy: "eligible_after_approval",
    status: "waiting",
    evidence: [
      "已收到并保留 1 张水晶 DIY 图片原文件",
      "创造者确认：与量化一样作为非主项目，先判断再决定",
      "首轮诉求：寻找灵感、本地已有资料和可复刻方案",
    ],
    source_reference: "material_dialogue_6757e03e9f124fb8ae76",
    states: {
      stage: "素材已登记，等待图片识别与复刻方案初判",
      priority: {
        lane: "孵化区",
        level: "保持关注",
        main_track: false,
        rationale: "方向已明确，但图片内容、目标用户和复刻成本仍需核实。",
      },
      risk: {
        level: "medium",
        facts: ["图片原文件已保存，当前仍等待识别"],
        unknowns: ["图片中的具体产品结构", "本地是否已有可复用方案", "材料和制作成本"],
        prohibited_actions: ["把未识别图片内容当成事实", "未经确认购买材料", "未经确认对外承诺", "未经确认启动开发"],
      },
      note: {
        first_outcome: "识别图片要素，整理灵感来源，并比较可复刻方案、成本和最小验证方式",
        next_action: "有空时先识别图片，再查找本地资料、公开灵感和可复刻方案",
        next_when_resumed: "先完成图片识别，再检索本地资料和公开灵感来源",
        execution_started: false,
      },
    },
  },
]);

function ensureAssessment(db, project) {
  const current = getCreatorPortfolio(db).find((item) => item.project_key === project.project_key)?.assessment;
  if (current?.status === "confirmed" && canonicalJson(current.factors) === canonicalJson(ASSESSMENT_FACTORS)) {
    return current;
  }
  return assessCreatorProject(db, project.project_key, {
    factors: ASSESSMENT_FACTORS,
    source: { kind: "creator_confirmation", reference: project.source_reference },
    confirm: true,
  });
}

function ensureState(db, project, stateKey, proposedValue, decidedBy) {
  const current = getProjectCurrentState(db, project.project_key)[stateKey]?.value;
  if (canonicalJson(current) === canonicalJson(proposedValue)) return null;
  const candidate = proposeProjectChange(db, project.project_key, {
    change_type: stateKey,
    summary: `${project.display_name}：${stateKey} 已由创造者确认`,
    proposed_value: proposedValue,
    impact: ["进入正式项目组合", "不改变主航道优先级", "不启动任务或 Agent"],
    source: { kind: "creator_confirmation", reference: project.source_reference },
    evidence: project.evidence,
    confidence: stateKey === "risk" ? "high" : "medium",
  });
  return decideProjectChange(db, candidate.change_id, {
    decision: "accept",
    decided_by: decidedBy,
    reason: "创造者明确要求将该方向作为非主项目纳入项目体系并先做判断。",
  });
}

export function registerCreatorIncubationProjects(db, { decidedBy = "local_creator" } = {}) {
  upsertCreatorProjectBaseline(db, {
    source: BASELINE_SOURCE,
    projects: INCUBATION_PROJECTS.map(({ states, source_reference, ...project }) => project),
  });

  return INCUBATION_PROJECTS.map((project) => {
    const assessment = ensureAssessment(db, project);
    const changes = Object.entries(project.states)
      .map(([stateKey, value]) => ensureState(db, project, stateKey, value, decidedBy))
      .filter(Boolean);
    return {
      project_key: project.project_key,
      display_name: project.display_name,
      assessment,
      accepted_change_ids: changes.map((change) => change.change_id),
    };
  });
}
