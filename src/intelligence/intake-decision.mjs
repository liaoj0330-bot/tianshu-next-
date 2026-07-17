import { containsMaterial } from "./material-intake.mjs";

const HIGH_RISK_ACTION = /(发消息|发送|发布|对外|删除|付款|支付|创建任务|派发|调度\s*agent|修改文件|写入正式记忆)/i;
const ACTION_REQUEST = /(帮我|请你|需要你|开始|继续|完成|生成|修复|创建|安排|执行|推进|调度|派发|验收)/i;
const CHANGE_SIGNAL = /(今天|最近|这周|刚刚|刚才|已经|现在|目前|进入|暂停|恢复|确认了|发生变化|改成|不再|新增|延期|提前|只是.{0,8}例子|不是我的.{0,8}项目|不属于我的)/i;
const QUESTION_SIGNAL = /[?？]|^(为什么|怎么|如何|是否|能不能|可不可以|你觉得|帮我判断)/i;

function base(mode, overrides = {}) {
  return {
    mode,
    completed: false,
    fulfillment_status: "pending",
    approval_required: false,
    execution_allowed: false,
    confidence: "medium",
    reason_codes: [],
    ...overrides,
  };
}

export function decideIntakeInteraction(message, analysis = {}) {
  const text = String(message ?? "").trim();
  if (!text) throw new Error("message is required");

  const materialInput = containsMaterial(text);
  const explicitInstruction = /^(请你|请|帮我|需要你|开始|继续|完成|生成|修复|创建|安排|执行|推进|调度|派发|验收)/i.test(text);

  if (materialInput && !explicitInstruction) {
    return base("project_intake", {
      fulfillment_status: "organizing_materials",
      confidence: "high",
      approval_required: true,
      reason_codes: ["material_bundle", "project_discovery_required"],
      summary: "已识别为项目线索素材；先整理、核验和形成首轮判断，再请你决定是否推进。",
      next_action: "prepare_project_alignment",
    });
  }

  if (HIGH_RISK_ACTION.test(text)) {
    return base("dispatch_request", {
      fulfillment_status: "awaiting_plan_and_approval",
      approval_required: true,
      confidence: "high",
      reason_codes: ["explicit_action", "controlled_action"],
      summary: "识别到需要受控执行的动作，必须先形成计划并由你确认。",
      next_action: "prepare_approval_bound_plan",
    });
  }

  if (QUESTION_SIGNAL.test(text)) {
    return base("direct_answer", {
      fulfillment_status: "requires_grounded_answer",
      reason_codes: ["answerable_request"],
      summary: "这是回答或判断请求，需要结合正式状态与证据生成答案；当前尚未完成回答。",
      next_action: "compose_grounded_answer",
    });
  }

  if (CHANGE_SIGNAL.test(text) && !/^(请|帮我|需要你|开始|继续|完成|生成|修复|创建|安排|执行|推进|调度|派发|验收)/i.test(text)) {
    return base("state_candidate", {
      fulfillment_status: "awaiting_state_comparison",
      reason_codes: ["possible_state_change"],
      summary: "这可能改变当前状态或项目判断；先作为候选变化，不直接改写正式状态。",
      next_action: "compare_with_current_state",
    });
  }

  if (ACTION_REQUEST.test(text)) {
    if (/^(继续|开始|推进|执行|完成|帮我|做一下|继续做|继续推进)[吧。！!\s]*$/i.test(text)) {
      return base("ask_one_question", {
        fulfillment_status: "awaiting_user_input",
        confidence: "high",
        reason_codes: ["action_missing_success_criteria"],
        question: "这次做到什么结果，才算完成？",
        summary: "识别到行动意图，但缺少对象或完成标准，不能安全形成计划。",
      });
    }
    return base("action_proposal", {
      fulfillment_status: "awaiting_action_contract",
      approval_required: true,
      reason_codes: ["explicit_action"],
      summary: "识别到明确行动诉求；先补齐完成标准、范围和证据，再决定是否派发。",
      next_action: "prepare_action_contract",
    });
  }

  if (CHANGE_SIGNAL.test(text)) {
    return base("state_candidate", {
      fulfillment_status: "awaiting_state_comparison",
      reason_codes: ["possible_state_change"],
      summary: "这可能改变当前状态或项目判断；先作为候选变化，不直接改写正式状态。",
      next_action: "compare_with_current_state",
    });
  }

  if (analysis.needs_questions || analysis.confidence === "low") {
    return base("ask_one_question", {
      fulfillment_status: "awaiting_user_input",
      confidence: "low",
      reason_codes: ["insufficient_intent_evidence"],
      question: "这次你最希望我帮你得到什么结果？",
      summary: "现有信息不足以安全判断下一步。",
    });
  }

  return base("state_candidate", {
    confidence: "low",
    reason_codes: ["unclassified_observation"],
    summary: "先把这条信息作为待理解的观察，不创建任务也不自动写入正式记忆。",
    next_action: "review_observation",
  });
}
