import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildResumePacket } from "../continuity/continuity.mjs";
const ensure = (path) => mkdirSync(dirname(path), { recursive: true });
const bullets = (items, empty = "暂无") => items?.length ? items.map((x) => "- " + x).join("\n") : "- " + empty;
const safe = (value) => String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
export function writeContinuityMirrors(db, { resumePath, problemsPath, contentPath, scope = "tianshu" }) {
  const packet = buildResumePacket(db, scope), cp = packet.checkpoint, stamp = new Date().toISOString(), fence = "\x60\x60\x60";
  const front = (title) => ["---", "title: " + title, "type: sqlite-read-model", "updated: " + stamp, "state_authority: sqlite", "---", ""];
  const resume = front("天枢继续执行包").concat([
    "# 天枢继续执行包", "", "> [!important] 恢复指令", "> " + packet.resume_instruction, "", "## 当前目标", "",
    cp ? "**" + cp.objective + "**" : "尚未建立检查点。", cp ? "- 阶段：" + cp.phase : "", cp ? "- 验收状态：" + cp.snapshot.acceptance_state : "", cp ? "- 检查点：" + cp.checkpoint_id : "",
    "", "## 已完成", "", bullets(cp?.snapshot.completed), "", "## 正在推进", "", bullets(cp?.snapshot.in_progress), "", "## 当前卡点", "", bullets(cp?.snapshot.blockers),
    "", "## 唯一下一步", "", "> " + (cp?.snapshot.next_action ?? "先建立正式检查点"), "", "## 恢复前检查", "",
    "- [ ] 核对 SQLite 正式状态", "- [ ] 核对 Git 本地与远端哈希", "- [ ] 核对服务健康状态", "- [ ] 核对未解决问题与待确认事项", "- [ ] 不重新规划已经完成的工作", "- [ ] 不访问受保护项目", "",
    fence + "mermaid", "flowchart LR", "    CLOSE[任务收尾] --> DB[(SQLite 检查点)]", "    DB --> API[Resume API]", "    API --> VERIFY[核对 Git / 服务 / 卡点]", "    VERIFY --> NEXT[从唯一下一步继续]", "    NEXT --> CLOSE", fence, "", "> 本页由 SQLite 生成，不能反向控制任务。", ""
  ]).filter((x) => x !== "").join("\n");
  const rows = packet.unresolved_problems.map((x) => "| " + safe(x.title) + " | " + safe(x.symptom) + " | " + x.status + " | " + x.occurrence_count + " | " + safe(x.recurrence_playbook) + " |").join("\n") || "| 暂无未解决问题 | - | - | 0 | - |";
  const problems = front("天枢问题与卡点地图").concat(["# 天枢问题与卡点地图", "", "| 问题 | 症状 | 状态 | 复发次数 | 下次先做什么 |", "| --- | --- | --- | ---: | --- |", rows, "", fence + "mermaid", "flowchart TD", "    S[发现相似症状] --> F[按 fingerprint 查历史问题]", "    F --> R[先执行复发处理手册]", "    R --> V[运行原验证方法]", "    V --> D{证据通过?}", "    D -->|否| O[保持 monitoring]", "    D -->|是| C[标记 resolved]", fence, ""]).join("\n");
  const ideas = packet.evolution_candidates.filter((x) => x.kind === "content_idea");
  const ideaText = ideas.map((x) => "## " + x.title + "\n\n- 状态：" + x.status + "\n- 来源：" + safe(x.payload.source_problem ?? x.source.reference ?? "任务复盘") + "\n- 适合形式：" + ((x.payload.formats ?? []).join("、") || "待判断") + "\n- 候选编号：" + x.candidate_id).join("\n\n") || "暂无内容候选。";
  const content = front("天枢自媒体内容候选池").concat(["# 天枢自媒体内容候选池", "", "> 从真实项目、真实问题和真实修复中提炼；候选不等于已经批准发布。", "", ideaText, ""]).join("\n");
  for (const [path, value] of [[resumePath, resume], [problemsPath, problems], [contentPath, content]]) { ensure(path); writeFileSync(path, value, "utf8"); }
  return { resumePath, problemsPath, contentPath, generated_at: stamp, checkpoint_id: cp?.checkpoint_id ?? null };
}