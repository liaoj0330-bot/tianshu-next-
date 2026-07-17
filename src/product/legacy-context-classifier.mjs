import { getConfirmationReadModel } from "./today-read-model.mjs";
import { getRecordContext, setRecordContext } from "./record-context.mjs";

const ACCEPTANCE_PATTERN = /验收|acceptance|agenthub[-_ ]?e2e|接口形状|只读任务/i;
const DEVELOPMENT_PATTERN = /开发版|单元测试|回归测试|工作区发生 git 变化|测试计划/i;

export function classifyLegacyRecord({ source = "", text = "" } = {}) {
  if (ACCEPTANCE_PATTERN.test(text)) return { context_kind: "acceptance", reason: "legacy record contains an explicit acceptance marker" };
  if (source === "agenthub-dev" || DEVELOPMENT_PATTERN.test(text)) return { context_kind: "development", reason: "legacy record originated from development activity" };
  return null;
}

export function planLegacyContextMigration(db) {
  const proposals = [];
  for (const row of db.prepare("SELECT intake_id,source,payload_json FROM intake_events ORDER BY created_at").all()) {
    const payload = JSON.parse(row.payload_json);
    const classification = classifyLegacyRecord({ source: row.source, text: payload.message ?? "" });
    if (classification && !getRecordContext(db, "intake", row.intake_id)) {
      proposals.push({ entity_type: "intake", entity_id: row.intake_id, ...classification });
    }
  }
  for (const item of getConfirmationReadModel(db)) {
    const text = `${item.title ?? ""}\n${item.summary ?? ""}`;
    const classification = classifyLegacyRecord({ text });
    if (classification && !getRecordContext(db, "confirmation", item.confirmation_id)) {
      proposals.push({ entity_type: "confirmation", entity_id: item.confirmation_id, ...classification });
    }
  }
  return proposals;
}

export function applyLegacyContextMigration(db, proposals = planLegacyContextMigration(db)) {
  return proposals.map((proposal) => setRecordContext(db, {
    ...proposal,
    visibility: "secondary",
    source: "legacy_context_migration",
    classified_by: "tianshu_orchestrator",
  }));
}
