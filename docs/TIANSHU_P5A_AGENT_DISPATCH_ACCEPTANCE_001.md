# TianShu P5-A 统一 Agent 调度｜验收报告

日期：2026-07-14  
范围：仅 TianShu Next 隔离实现。Teacher PPT、069、070 和业务项目未读取、未修改、未派发。

## 结论

P5-A 的最小统一 Agent 调度闭环通过：四个本机 Agent 都能由天枢注册、启动安全探测、返回退出码与输出，并记录到 SQLite 的 `agent_runs` 和事件表。

## 已接入

| Agent | 统一调度结果 | 返回版本 |
|---|---|---|
| Codex | 成功 | `codex-cli 0.144.1` |
| Claude Code | 成功 | `2.1.179 (Claude Code)` |
| Hermes | 成功 | `Hermes Agent v0.15.1` |
| OpenClaw | 成功 | `2026.3.2` |

## 已实现

- Agent 注册表；
- Agent 能力声明；
- Agent 风险等级；
- Agent 参数记录；
- 统一调度器；
- 超时处理；
- 退出码、stdout、stderr 回收；
- Agent Run SQLite 记录；
- append-only 事件记录；
- OpenClaw PowerShell 入口兼容处理。

## 验收证据

- TianShu Next 完整自动测试：**25/25 通过**；
- 四个 Agent 的真实 `--version` 探测：**4/4 成功**。

## 严格边界

本轮证明的是统一调度和结果回收真实可用，不等于已经证明四个 Agent 都能完成真实项目任务。

下一轮应在 TianShu 自有测试仓中分别运行：

- Codex 受控修改；
- Claude Code 只读分析或受控修改；
- Hermes 上下文跟进任务；
- OpenClaw 入口请求；
- 跨 Agent 独立复核。

在这些测试通过前，业务项目自动执行继续关闭。
