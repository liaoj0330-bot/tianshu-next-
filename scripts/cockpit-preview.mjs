import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";
import { enqueueJob } from "../src/runtime/governance.mjs";
import {
  createExperienceCandidate,
  createJudgment,
  decideExperience,
  decideJudgment,
  decideOutcome,
  recordExperienceCounterexample,
  recordOutcome,
} from "../src/intelligence/judgment-loop.mjs";
import { QUANT_ACCEPTANCE_INPUT } from "../test/fixtures/quant-material-acceptance.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function judgmentInput(question, recommendation) {
  return {
    subject_type: "system_design",
    subject_id: "tianshu-cockpit-preview",
    workspace: "evolution",
    question,
    facts: [{ claim: "奈奈是唯一目标拥有者和最终验收者" }],
    inferences: [{ claim: "所有正式变化必须保留确认边界" }],
    evidence: [{ ref: "authority baseline" }],
    uncertainties: [{ question: "这条规则的适用范围是否足够精确？" }],
    alternatives: [{ option: "让交互渠道自动确认", rejected_because: "越过奈奈决定权" }],
    recommendation: { action: recommendation },
    confidence: "high",
  };
}

function seedPreview(db) {
  if (!db.prepare("SELECT COUNT(*) count FROM jobs").get().count) {
    enqueueJob(db, {
      projectId: "tianshu-next",
      payload: { action: "生成驾驶舱隔离验收证据" },
      maxAttempts: 2,
    });
  }
  if (db.prepare("SELECT COUNT(*) count FROM judgments").get().count) return;

  createJudgment(db, judgmentInput(
    "AgentHub 收到明确行动请求后，是否可以直接启动执行？",
    "先呈现计划和后果，再由奈奈分别确认计划与执行边界。",
  ));

  const outcomeJudgment = createJudgment(db, judgmentInput(
    "怎样确认一次执行真的产生了预期结果？",
    "Executor 报告输出，独立 Verifier 检查证据，最后由奈奈验收。",
  ));
  decideJudgment(db, outcomeJudgment.judgment_id, {
    decision: "accept",
    reason: "符合执行与验证分离原则",
    decided_by: "nainai",
  });
  recordOutcome(db, outcomeJudgment.judgment_id, {
    summary: "执行产物已经生成，但仍需要奈奈确认真实效果",
    result: { output_created: true, creator_value_confirmed: false },
    evidence: [{ check: "artifact exists", passed: true }],
    recorded_by: "executor",
  });

  const experienceJudgment = createJudgment(db, judgmentInput(
    "交互表面能否替奈奈确认正式状态？",
    "交互表面只负责提交和呈现，不能拥有决定权。",
  ));
  decideJudgment(db, experienceJudgment.judgment_id, {
    decision: "accept",
    reason: "边界明确",
    decided_by: "nainai",
  });
  const confirmedOutcome = recordOutcome(db, experienceJudgment.judgment_id, {
    summary: "越权确认被权限门禁阻止",
    result: { unauthorized_confirmation_count: 0 },
    evidence: [{ check: "authority denial", passed: true }],
    recorded_by: "executor",
  });
  decideOutcome(db, confirmedOutcome.outcome_id, {
    decision: "confirm",
    reason: "证据与预期一致",
    decided_by: "nainai",
  });
  const candidate = createExperienceCandidate(db, confirmedOutcome.outcome_id, {
    title: "正式变化必须由奈奈确认",
    rule: { when: "操作会改变正式状态", then: "先说明后果并请求奈奈确认" },
    applicability: { mutations_only: true, surfaces: ["agenthub", "web", "obsidian"] },
  });
  const experience = decideExperience(db, candidate.experience_id, {
    decision: "activate",
    reason: "规则可复用且边界清晰",
    decided_by: "nainai",
  });

  const later = createJudgment(db, {
    ...judgmentInput(
      "只读 Today 页面是否也需要每次请求奈奈确认？",
      "只读呈现不需要授权，只有状态变化才需要确认。",
    ),
    experience_citations: [{
      experience_version_id: experience.current_version_id,
      influence: { effect: "识别确认边界" },
    }],
  });
  decideJudgment(db, later.judgment_id, {
    decision: "correct",
    correction: { recommendation: { action: "只读呈现不需要授权；正式状态变化必须确认。" } },
    reason: "需要明确排除只读展示",
    decided_by: "nainai",
  });
  recordExperienceCounterexample(db, experience.experience_id, {
    observation: {
      context: "只读 Today 呈现",
      contradiction: "如果把确认规则扩展到只读展示，会制造不必要摩擦。",
    },
    evidence: [{ judgment_id: later.judgment_id }],
  });
}

const statePath = resolve(argument("--state", join(tmpdir(), "tianshu-cockpit-preview.sqlite")));
const port = Number(argument("--port", "4173"));
const db = openStore(statePath);
if (process.argv.includes("--seed")) seedPreview(db);
const gateway = createGateway({ db, port });
const address = await gateway.listen();
const baseUrl = `http://${address.address}:${address.port}`;
if (process.argv.includes("--quant-acceptance")) {
  const response = await fetch(`${baseUrl}/v1/channels/agenthub/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: QUANT_ACCEPTANCE_INPUT,
      conversation_id: "quant-new-version-visual-acceptance",
      message_id: "quant-materials-11-visual-v1",
      idempotency_key: "quant-materials-11-visual-v1",
      actor_id: "local_creator",
      actor_kind: "creator",
      metadata: { context_kind: "product", acceptance_scenario: "bulk_material_project_alignment" },
    }),
  });
  if (!response.ok) throw new Error(`quant acceptance seed failed: ${response.status} ${await response.text()}`);
}
console.log(`TianShu AgentHub preview: ${baseUrl}/agenthub`);
console.log(`Isolated SQLite state: ${statePath}`);

async function close() {
  await gateway.close();
  db.close();
  process.exit(0);
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
