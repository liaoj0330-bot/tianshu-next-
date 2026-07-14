# 天枢跨会话连续性与受控进化报告 001

日期：2026-07-15

## 目标

解决关闭对话、切换模型或重新接入 API 后只能看到进度、却不知道卡点、失败历史和唯一下一步的问题。SQLite 仍是唯一机器状态源；Obsidian 只呈现可读镜像。

## 新增能力

### 继续执行检查点

保存目标、阶段、已完成、进行中、卡点、唯一下一步、证据、仓库、服务、待确认事项和保护边界。每个 scope 只有一个 current 检查点，旧检查点保留为 historical。

### 问题与卡点台账

每个问题包含 fingerprint、症状、根因、解决办法、复发处理手册、验证方法和状态。同一 fingerprint 再次出现时累计 occurrence count，不制造重复记忆。

### 受控进化候选

- `operational_rule`：可复用治理规则，仍需确认后才能升级。
- `content_idea`：来自真实问题和修复过程的自媒体候选，不自动发布。

### Resume API

```http
GET /v1/continuity/resume?scope=tianshu
POST /v1/continuity/checkpoints
POST /v1/continuity/close-turn
GET /v1/continuity/problems
POST /v1/continuity/problems
GET /v1/continuity/evolution-candidates?kind=content_idea
```

恢复顺序固定为：SQLite 检查点 → 未解决问题 → 待确认事项 → 活跃任务 → 候选经验 → 最近事件。返回明确 `resume_instruction`，要求先核对阻塞、Git、服务和验收状态，不重新规划已完成工作。

## 原子性与权力边界

`close-turn` 使用事务和嵌套 savepoint。如果问题、候选或检查点任意一步失败，整次收尾全部回滚。收尾不会创建 Task、Run 或派发 Agent。

## 正式问题资产

本轮已写入正式 SQLite：

1. Executor 退出码成功但没有实际修改。
2. 前端完成但后端端到端链路没有贯通。
3. 样本验证被错误描述为产品完成。
4. 本地提交被误认为 GitHub 已同步。
5. Obsidian 进度与工程事实脱节。

同时生成两条治理规则候选和六个真实实践内容候选。

## Obsidian 镜像

- `00_入口导航/17_天枢继续执行包.md`
- `00_入口导航/18_天枢问题与卡点地图.md`
- `20_长期工作区/02_内容选题与发布/天枢真实实践内容候选池.md`

三页均由正式 SQLite 生成，不能反向控制任务。

## 验收证据

- 连续性定向测试：5/5 通过。
- 完整测试：80/80 通过。
- 覆盖关闭再打开 SQLite、Gateway 重启恢复、问题复发去重、Obsidian 生成、非法候选原子回滚。

## 尚未完成

- AgentHub 尚未提供“继续上次工作”可视入口。
- 每日回顾尚未自动触发 close-turn。
- 进化候选的奈奈确认/提升 API 尚未接入。
- 真实 P5 Executor → Verifier 链路仍是下一主验收门。