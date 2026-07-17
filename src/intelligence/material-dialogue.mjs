import { canonicalJson, newId, now } from "../core/store.mjs";

const parse = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

export const MATERIAL_STAGE_LABELS = Object.freeze({
  materials_received: "已收到素材",
  needs_one_answer: "还需要你确认一件事",
  understanding_ready: "我目前的理解",
  research_ready: "我准备先这样查",
  plan_ready: "接下来准备这样做",
  execution_authorization: "是否现在开始执行",
  acceptance_result: "结果是否符合你的要求",
});

const QUESTION_DEFINITIONS = [
  {
    key: "goal",
    question: "这批素材最后要帮你解决什么问题，或者形成什么结果？",
    why_it_matters: "先确定真正目标，避免把整理素材本身误当成结果。",
    known: (text, brief) => Boolean(brief.requested_outcomes?.length) || /目标|希望|想要|用于|用来|解决|形成.{0,8}(?:结果|方案|判断)/u.test(text),
  },
  {
    key: "success_criteria",
    question: "第一轮做到什么程度，你会认为这批素材已经整理到位？",
    why_it_matters: "用来定义可以验收的完成标准，避免无限整理。",
    known: (text, brief) => Boolean(brief.requested_outcomes?.length) || /验收|完成标准|做到|交付|最小可行|MVP|资料核验|需求澄清/u.test(text),
  },
  {
    key: "hard_boundaries",
    question: "这件事有哪些绝对不能做、不能承诺或不能触碰的边界？",
    why_it_matters: "先锁定硬边界，后面的调研和计划才不会越权。",
    known: (text, brief) => Boolean(brief.prohibited_actions?.length) || /不授权|禁止|不能|不要|不做|只读/u.test(text),
  },
  {
    key: "audience",
    question: "这次最终是服务你自己、内部团队，还是要形成给客户的交付？",
    why_it_matters: "对象不同，会直接改变证据标准、表达方式和方案范围。",
    known: (text) => /给客户|客户交付|面向客户|客户要|自己使用|自用|个人使用|内部团队|团队使用|内部使用/u.test(text),
  },
];

function publicMaterial(item, index) {
  const { text_content, content_data_url, ...safe } = item;
  return { position: index + 1, ...safe };
}

export function buildMaterialReceipt(brief) {
  const materials = Array.isArray(brief?.materials) ? brief.materials : [];
  const pendingContent = materials.filter((item) => /pending|metadata_only/u.test(String(item.content_status ?? ""))).length;
  return {
    kind: "material_receipt",
    display_title: MATERIAL_STAGE_LABELS.materials_received,
    submitted_count: materials.length,
    registered_count: materials.length,
    issue_count: 0,
    pending_content_count: pendingContent,
    order_preserved: true,
    source_preserved: true,
    original_content_preserved: true,
    submitted_original_preserved: true,
    external_content_fetched: false,
    content_boundary: pendingContent
      ? "已保留提交时的原文、文件或来源；外部链接内容与待识别文件尚未被当作已读取事实。"
      : "已保留提交时的原始内容。",
    items: materials.map(publicMaterial),
  };
}

export function selectNextMaterialQuestion({ message, brief, clarifications = [], asked_question_keys = [] }) {
  const answered = new Set([
    ...asked_question_keys,
    ...clarifications.map((item) => item.question_key),
  ]);
  const text = [message, ...clarifications.map((item) => item.answer)].filter(Boolean).join("\n");
  const definition = QUESTION_DEFINITIONS.find((item) => !answered.has(item.key) && !item.known(text, brief));
  return definition ? {
    key: definition.key,
    text: definition.question,
    why_it_matters: definition.why_it_matters,
    answer_mode: "free_text",
  } : null;
}

function decorate(row) {
  if (!row) return null;
  return {
    ...row,
    brief: parse(row.brief_json, {}),
    receipt: parse(row.receipt_json, {}),
    clarifications: parse(row.clarifications_json, []),
    current_question: parse(row.current_question_json, null),
    asked_question_keys: parse(row.asked_question_keys_json, []),
    brief_json: undefined,
    receipt_json: undefined,
    clarifications_json: undefined,
    current_question_json: undefined,
    asked_question_keys_json: undefined,
  };
}

export function createMaterialDialogue(db, { session_id, intake_id, message, brief, receipt }) {
  const question = selectNextMaterialQuestion({ message, brief });
  const stamp = now();
  const dialogueId = newId("material_dialogue");
  const status = question ? "awaiting_answer" : "understanding_ready";
  const phase = question ? "needs_one_answer" : "understanding_ready";
  db.prepare(`
    INSERT INTO material_dialogues(
      dialogue_id,session_id,root_intake_id,current_intake_id,status,phase,
      brief_json,receipt_json,clarifications_json,current_question_json,
      asked_question_keys_json,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    dialogueId, session_id, intake_id, intake_id, status, phase,
    canonicalJson(brief), canonicalJson(receipt), canonicalJson([]),
    question ? canonicalJson(question) : null,
    canonicalJson(question ? [question.key] : []), stamp, stamp,
  );
  db.prepare(`
    INSERT INTO material_dialogue_turns(
      turn_id,dialogue_id,intake_id,turn_index,turn_kind,question_key,answer_text,created_at
    ) VALUES (?,?,?,1,'submission',NULL,NULL,?)
  `).run(newId("material_turn"), dialogueId, intake_id, stamp);
  return getMaterialDialogue(db, dialogueId);
}

export function getMaterialDialogue(db, dialogueId) {
  return decorate(db.prepare("SELECT * FROM material_dialogues WHERE dialogue_id=?").get(dialogueId));
}

export function getPendingMaterialDialogue(db, sessionId) {
  return decorate(db.prepare(`
    SELECT * FROM material_dialogues
    WHERE session_id=? AND status='awaiting_answer'
    ORDER BY updated_at DESC LIMIT 1
  `).get(sessionId));
}

export function decideMaterialUnderstanding(db, dialogueId, decision) {
  if (!["confirm", "revise", "reject"].includes(decision)) throw new Error("invalid material understanding decision");
  const dialogue = getMaterialDialogue(db, dialogueId);
  if (!dialogue || dialogue.status !== "understanding_ready") {
    throw new Error("material understanding is not awaiting creator confirmation");
  }
  const stamp = now();
  if (decision === "confirm") {
    db.prepare(`
      UPDATE material_dialogues
      SET status='closed',phase='closed',current_question_json=NULL,updated_at=?
      WHERE dialogue_id=? AND status='understanding_ready'
    `).run(stamp, dialogueId);
  } else if (decision === "revise") {
    const question = {
      key: "understanding_revision",
      text: "请直接说哪一处理解需要修改，或补充遗漏的目标、边界和材料。",
      why_it_matters: "你的修正会进入下一版理解；在你再次确认前，不会生成调研计划。",
      answer_mode: "free_text",
    };
    db.prepare(`
      UPDATE material_dialogues
      SET status='awaiting_answer',phase='needs_one_answer',current_question_json=?,
          asked_question_keys_json=?,updated_at=?
      WHERE dialogue_id=? AND status='understanding_ready'
    `).run(
      canonicalJson(question),
      canonicalJson([...new Set([...dialogue.asked_question_keys, question.key])]),
      stamp,
      dialogueId,
    );
  } else {
    db.prepare(`
      UPDATE material_dialogues
      SET status='rejected',phase='closed',current_question_json=NULL,updated_at=?
      WHERE dialogue_id=? AND status='understanding_ready'
    `).run(stamp, dialogueId);
  }
  return getMaterialDialogue(db, dialogueId);
}

function nextTurnIndex(db, dialogueId) {
  return (db.prepare("SELECT MAX(turn_index) value FROM material_dialogue_turns WHERE dialogue_id=?").get(dialogueId).value ?? 0) + 1;
}

export function recordMaterialAddition(db, dialogue, { intake_id, brief }) {
  const stamp = now();
  db.prepare(`
    INSERT INTO material_dialogue_turns(
      turn_id,dialogue_id,intake_id,turn_index,turn_kind,question_key,answer_text,created_at
    ) VALUES (?,?,?,?,'material_addition',NULL,NULL,?)
  `).run(newId("material_turn"), dialogue.dialogue_id, intake_id, nextTurnIndex(db, dialogue.dialogue_id), stamp);
  db.prepare(`
    UPDATE material_dialogues SET current_intake_id=?,brief_json=?,receipt_json=?,updated_at=?
    WHERE dialogue_id=? AND status='awaiting_answer'
  `).run(intake_id, canonicalJson(brief), canonicalJson(buildMaterialReceipt(brief)), stamp, dialogue.dialogue_id);
  return getMaterialDialogue(db, dialogue.dialogue_id);
}

export function recordMaterialAnswer(db, dialogue, { intake_id, answer, root_message, brief }) {
  const currentQuestion = dialogue.current_question;
  if (!currentQuestion) throw new Error("material dialogue has no current question");
  const stamp = now();
  const clarifications = [
    ...dialogue.clarifications,
    {
      question_key: currentQuestion.key,
      question: currentQuestion.text,
      answer: String(answer ?? "").trim(),
      answered_at: stamp,
    },
  ];
  const question = selectNextMaterialQuestion({
    message: root_message,
    brief,
    clarifications,
    asked_question_keys: dialogue.asked_question_keys,
  });
  const askedKeys = question
    ? [...new Set([...dialogue.asked_question_keys, question.key])]
    : dialogue.asked_question_keys;
  const status = question ? "awaiting_answer" : "understanding_ready";
  const phase = question ? "needs_one_answer" : "understanding_ready";
  db.prepare(`
    INSERT INTO material_dialogue_turns(
      turn_id,dialogue_id,intake_id,turn_index,turn_kind,question_key,answer_text,created_at
    ) VALUES (?,?,?,?,'answer',?,?,?)
  `).run(
    newId("material_turn"), dialogue.dialogue_id, intake_id,
    nextTurnIndex(db, dialogue.dialogue_id), currentQuestion.key,
    String(answer ?? "").trim(), stamp,
  );
  db.prepare(`
    UPDATE material_dialogues
    SET current_intake_id=?,status=?,phase=?,brief_json=?,receipt_json=?,
        clarifications_json=?,current_question_json=?,asked_question_keys_json=?,updated_at=?
    WHERE dialogue_id=? AND status='awaiting_answer'
  `).run(
    intake_id, status, phase, canonicalJson(brief), canonicalJson(buildMaterialReceipt(brief)),
    canonicalJson(clarifications), question ? canonicalJson(question) : null,
    canonicalJson(askedKeys), stamp, dialogue.dialogue_id,
  );
  return getMaterialDialogue(db, dialogue.dialogue_id);
}
