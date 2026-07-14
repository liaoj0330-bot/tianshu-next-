# TianShu Next

TianShu Next（天枢）是一个隔离开发的个人 AI 工作操作系统控制平面。目标不是做一个聊天页面，而是把“理解奈奈、识别变化、判断项目、受控调用 Agent、独立验收、长期治理”连接成可审计的产品链路。

## 产品原则

- SQLite 是唯一机器状态源；Markdown 只做说明、证据报告或只读镜像。
- 用户输入先形成判断、状态候选或计划候选，不直接触发执行。
- 计划确认与执行边界确认是两个独立关口。
- Executor 只能报告输出，不能验证结果或宣布目标完成。
- 退出码为 0 不等于成功；Git 变化、预期内容、允许路径和独立复核共同构成证据。
- Teacher PPT、069、070 及业务项目仓库属于禁止访问范围。

## 六阶段路线

1. P1：认识奈奈——长期身份、目标、偏好与决策原则。
2. P2：理解变化——区分稳定状态、当前状态和未来方向。
3. P3：主动项目辅助——识别真实项目、量化优先级并给出下一步。
4. P4：长期运行治理——恢复、并发、超时、取消、重试和证据留存。
5. P5：统一 Agent 调度与真实隔离执行——执行者、复核者、路径和审批分离。
6. P6：交互、知识镜像与真实试点。

当前边界：P1–P4 基础能力已有可执行证据；P5-A 统一调度及四 Agent 安全探测已有证据；P5 真实代码任务和跨 Agent 独立复核仍在验收。P6 隔离样本验证不等于业务产品完成。

## 当前产品闭环

`POST /v1/intake` 根据输入返回真实产品交互：

- `direct_answer`：基于 SQLite 状态和项目证据给出判断、理由、不确定性与下一步。
- `ask_one_question`：证据不足时只追问一个关键问题。
- `state_candidate`：生成状态变化卡，等待接受、修正或拒绝。
- `action_proposal`：生成结构化、可版本化的计划候选。
- `dispatch_request`：仍先进入计划与执行审批，不直接调用 Agent。

```text
自然语言输入
  -> 意图与项目匹配
  -> 判断 / 状态候选 / 计划候选
  -> 奈奈确认计划
  -> 创建 Goal + Plan（不创建 Run）
  -> 配置 executor / verifier / allowed paths / timeout / retries
  -> 奈奈第二次确认执行边界
  -> 创建 Task（仍不自动启动 Run）
  -> 后续由受控调度器执行并进入独立复核
```

计划修改创建新版本并 supersede 旧版本；只有当前版本可确认。禁止访问项目即使命中名称也会 fail closed。

## 主要接口

- `GET /health`：运行状态。
- `GET /v1/today`：今日重点、变化、待确认项、项目排序和执行摘要。
- `POST /v1/intake`：统一自然语言入口。
- `GET /v1/intakes`、`GET /v1/confirmations`：持久化记录与待确认事项。
- `GET /v1/creator/portfolio`、`POST /v1/creator/project-match`：项目组合与严格匹配。
- `POST /v1/plan-candidates/:id/revise`：计划版本修订。
- `POST /v1/intakes/:id/plan-decision`：第一次确认，建立 Goal 与 Plan。
- `POST /v1/plans/:id/execution-boundary`：配置执行隔离边界。
- `POST /v1/plans/:id/execution-decision`：第二次确认，建立 Task 但不启动 Run。

## 运行与验收

要求 Node.js 22+：

```powershell
cd D:\AI_Workspace\tianshu-next-
npm test
npm run service
```

当前完整测试基线：**80/80 通过**。覆盖可信内核、动态状态、项目量化、统一入口、计划版本、双确认、退出码假成功、越界修改、超时、取消、重试、独立复核、恢复和 SQLite 镜像回写。

## 文档入口

- [产品路线基线](docs/TIANSHU_PRODUCT_ROADMAP_003.md)
- [产品闭环与 P5 当前状态](docs/TIANSHU_PRODUCT_LOOP_P5_STATUS_002.md)
- [天枢系统可视化结构图](docs/TIANSHU_SYSTEM_VISUAL_MAP_001.md)
- [Obsidian 可视化回写证据](docs/TIANSHU_OBSIDIAN_VISUAL_WRITEBACK_002.md)
- [跨会话连续性与受控进化报告](docs/TIANSHU_CONTINUITY_EVOLUTION_REPORT_001.md)
- [P5 生命周期证据](docs/TIANSHU_P5_LIFECYCLE_EVIDENCE_002.md)
- [P5 加固证据](docs/TIANSHU_P5_HARDENING_EVIDENCE_003.md)
- [AgentHub 接入验收](docs/TIANSHU_GATEWAY_AGENTHUB_ACCEPTANCE_001.md)

## 尚未完成

- 不能把隔离探测或样本任务描述为真实业务产品完成。
- 仍需完成真实代码任务的 executor → independent verifier → creator decision 全链路。
- 仍需在 AgentHub 完整呈现运行进度、失败、取消、超时、重试和复核证据。
- 正式 Vault 只能由 SQLite 生成可读镜像，不能反向成为机器状态源。