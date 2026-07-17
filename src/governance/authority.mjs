import { DEFAULT_CREATOR_ID, getProductProfile } from "../product/product-profile.mjs";

export const LEGACY_CREATOR_ID = "nainai";
export const CREATOR_ID = DEFAULT_CREATOR_ID;

export const AUTHORITY_BASELINE_V1 = Object.freeze([
  { principal_id: LEGACY_CREATOR_ID, principal_kind: "creator", capability: "goal.own", effect: "allow", requires_creator_confirmation: false, rationale: "奈奈是所有目标的唯一拥有者。" },
  { principal_id: LEGACY_CREATOR_ID, principal_kind: "creator", capability: "formal_state.confirm", effect: "allow", requires_creator_confirmation: false, rationale: "只有奈奈可以确认或纠正正式状态。" },
  { principal_id: LEGACY_CREATOR_ID, principal_kind: "creator", capability: "execution.approve", effect: "allow", requires_creator_confirmation: false, rationale: "只有奈奈可以批准执行边界。" },
  { principal_id: LEGACY_CREATOR_ID, principal_kind: "creator", capability: "goal.final_accept", effect: "allow", requires_creator_confirmation: false, rationale: "只有奈奈可以最终接受或拒绝目标结果。" },
  { principal_id: LEGACY_CREATOR_ID, principal_kind: "creator", capability: "experience.promote", effect: "allow", requires_creator_confirmation: false, rationale: "只有奈奈可以把经验候选提升为正式经验。" },
  { principal_id: "tianshu_orchestrator", principal_kind: "control_plane", capability: "machine_state.transition", effect: "allow", requires_creator_confirmation: true, rationale: "天枢只能通过受治理状态转换写入 SQLite。" },
  { principal_id: "tianshu_orchestrator", principal_kind: "control_plane", capability: "execution.approve", effect: "deny", requires_creator_confirmation: true, rationale: "天枢可以准备执行边界，但不能替奈奈批准执行。" },
  { principal_id: "agenthub", principal_kind: "interaction_channel", capability: "intake.submit", effect: "allow", requires_creator_confirmation: false, rationale: "AgentHub 负责传递输入和展示结果。" },
  { principal_id: "agenthub", principal_kind: "interaction_channel", capability: "formal_state.confirm", effect: "deny", requires_creator_confirmation: true, rationale: "AgentHub 不能代替奈奈做决定。" },
  { principal_id: "obsidian", principal_kind: "read_model", capability: "machine_state.transition", effect: "deny", requires_creator_confirmation: true, rationale: "Obsidian 是可读工作台，不是机器状态源。" },
  { principal_id: "external_advisor", principal_kind: "advisory_source", capability: "formal_state.confirm", effect: "deny", requires_creator_confirmation: true, rationale: "外部建议必须经过奈奈处理后才能进入正式状态。" },
  { principal_id: "executor", principal_kind: "executor", capability: "execution.report", effect: "allow", requires_creator_confirmation: false, rationale: "Executor 可以报告输出，不能验证或完成目标。" },
  { principal_id: "executor", principal_kind: "executor", capability: "execution.verify", effect: "deny", requires_creator_confirmation: true, rationale: "Executor 不能验证自己的执行。" },
  { principal_id: "executor", principal_kind: "executor", capability: "goal.final_accept", effect: "deny", requires_creator_confirmation: true, rationale: "Executor 不能完成目标。" },
  { principal_id: "independent_verifier", principal_kind: "verifier", capability: "execution.verify", effect: "allow", requires_creator_confirmation: false, rationale: "独立验证者可以验证证据。" },
  { principal_id: "independent_verifier", principal_kind: "verifier", capability: "goal.final_accept", effect: "deny", requires_creator_confirmation: true, rationale: "验证通过不等于奈奈最终接受。" },
]);

// Runtime callers use the current baseline. Migrations import the versioned
// constant so later policy additions cannot change an already-applied checksum.
export const AUTHORITY_BASELINE = AUTHORITY_BASELINE_V1;

export function normalizePrincipalId(principalId, db) {
  const value = String(principalId ?? "").trim().toLowerCase();
  const profile = db ? getProductProfile(db) : null;
  const creatorId = profile?.actor_id ?? CREATOR_ID;
  const aliases = ["creator", LEGACY_CREATOR_ID, "奈奈", creatorId, profile?.display_name?.toLowerCase()].filter(Boolean);
  if (aliases.includes(value)) return creatorId;
  return value;
}

export function assertAuthority(db, principalId, capability) {
  const normalized = normalizePrincipalId(principalId, db);
  if (!normalized) throw new Error(`${capability} requires an identified principal`);
  const policy = db.prepare(`
    SELECT effect FROM authority_policies
    WHERE principal_id=? AND capability=? AND status='active'
    ORDER BY policy_version DESC LIMIT 1
  `).get(normalized, capability);
  if (!policy || policy.effect !== "allow") {
    throw new Error(`${normalized} is not authorized for ${capability}`);
  }
  return normalized;
}

export function getAuthorityReadModel(db) {
  const profile = getProductProfile(db);
  return {
    creator_id: profile.actor_id,
    creator_profile: profile,
    machine_state_authority: "sqlite",
    interaction_channel: "agenthub",
    knowledge_workbench: "obsidian",
    policies: db.prepare(`
      SELECT principal_id,principal_kind,capability,effect,
             requires_creator_confirmation,rationale,policy_version
      FROM authority_policies WHERE status='active'
      ORDER BY principal_kind,principal_id,capability
    `).all().map((row) => ({
      ...row,
      requires_creator_confirmation: Boolean(row.requires_creator_confirmation),
    })),
  };
}
