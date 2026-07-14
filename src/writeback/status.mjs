import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeStatusMirror(db, outputPath) {
  const counts = {
    goals: db.prepare("SELECT COUNT(*) AS count FROM goals").get().count,
    runs: db.prepare("SELECT COUNT(*) AS count FROM runs").get().count,
    accepted: db.prepare("SELECT COUNT(*) AS count FROM decisions WHERE decision='accept'").get().count,
    rejected: db.prepare("SELECT COUNT(*) AS count FROM decisions WHERE decision='reject'").get().count,
    candidates: db.prepare("SELECT COUNT(*) AS count FROM memory_candidates WHERE status='candidate'").get().count,
  };
  const latest = db.prepare("SELECT event_type, created_at FROM events ORDER BY event_id DESC LIMIT 10").all();
  const content = `# TianShu 运行状态镜像\n\n更新时间：${new Date().toISOString()}\n\n## 这页是干什么的\n\n这是机器状态的可读镜像，SQLite 是唯一状态真相。\n\n## 当前统计\n\n- 目标：${counts.goals}\n- 运行：${counts.runs}\n- 接受：${counts.accepted}\n- 拒绝：${counts.rejected}\n- 待判断记忆候选：${counts.candidates}\n\n## 最近事件\n\n${latest.map((item) => `- ${item.created_at} · ${item.event_type}`).join("\\n") || "- 暂无事件"}\n`;
  mkdirSync(dirname(outputPath), { recursive: true }); writeFileSync(outputPath, content, "utf8"); return outputPath;
}
