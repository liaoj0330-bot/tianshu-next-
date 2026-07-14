# TianShu P5-B 多 Agent 文本任务调度｜当前状态

日期：2026-07-14

## 已完成

- 统一文本任务调度接口；
- Agent Run 持久记录；
- 退出码、stdout、stderr 回收；
- 超时结果归档；
- 隔离文本任务测试通过；
- Claude Code 真实文本任务返回成功；
- Hermes 真实文本任务返回成功；
- Codex 真实文本任务返回成功；
- OpenClaw 真实文本任务返回成功；
- 四个 Agent 已通过 TianShu 统一调度器真实返回。

## 已整改问题

- Codex 调度器已主动关闭 stdin，避免进程等待额外输入；
- OpenClaw 已改用 Windows `cmd.exe` 参数编排，避免 PowerShell 多参数丢失；
- 自定义 provider 配置已在本地 `.codex-home` 生效，目录被 `.gitignore` 排除。

## 尚未完成

- 四个 Agent 的真实代码任务和跨 Agent 独立复核尚未完成；
- 当前验证是只读文本任务，不开放业务项目写入。

## 验收证据

- TianShu Next 自动测试：**26/26 通过**；
- Claude Code、Hermes、Codex、OpenClaw 均由统一调度器成功返回文本结果；
- TianShu Next 自动测试：**26/26 通过**。

## 下一步

继续使用安全隔离任务推进真实代码任务和跨 Agent 独立复核；在复核通过前，不开放业务项目自动执行。
