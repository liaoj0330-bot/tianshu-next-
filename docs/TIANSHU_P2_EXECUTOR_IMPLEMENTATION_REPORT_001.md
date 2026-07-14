# TIANSHU_P2_EXECUTOR_IMPLEMENTATION_REPORT_001

日期：2026-07-13  
状态：P1/P2 在独立 TianShu Next 范围内完成  
边界：未修改或测试现有 Control Center、教师 PPT、069、070 和业务项目

## P1 可信内核

已实现：

- SQLite Goal、Plan、Approval、Task、Run、Verification、Decision、Artifact 和 append-only Event。
- Goal Contract、Plan 规范及事件不可变约束。
- 审批绑定规范化计划 SHA-256。
- Executor、独立 Verifier 和 Creator Decision 权限分离。
- 非法 Run 状态迁移拒绝。
- 重启后运行中 Run 转为 `recovery_required`。

P1 验收：5/5。

## P2 Codex Executor

已实现：

- 从 `%USERPROFILE%\.codex\packages\standalone\releases` 解析最新完整发行包。
- 同时要求 `codex.exe`、Windows sandbox setup helper 和 command runner 存在。
- 使用 `workspace-write`、固定仓库根、`approval_policy=never` 和 ephemeral session。
- 子进程 stdin 显式关闭，避免 `codex exec` 等待附加输入。
- stdout、stderr 和最后消息脱敏、落盘并登记 SHA-256。
- 独立验收同时读取已跟踪 diff 与未跟踪文件，避免越界新增文件漏检。
- Plan 可显式声明字节精确或 `lf_or_crlf` 文本换行策略，默认不放宽。
- `exit_code=0` 只有在真实 Git、内容和范围验收通过后才可进入接受门。

P1/P2 自动验收：11/11。

## 真实失败反例

1. PATH 启动器未正确定位 Windows sandbox helper：模型可调用，但无法执行写入。
2. 子进程 stdin 未关闭：Codex 等待附加输入并在 10 分钟后超时；Goal 正确拒绝。
3. Codex 退出码为 0，但遗漏句号：字节验收失败，Goal 正确拒绝。
4. 内容正确但换行策略与 Plan 不一致：验收失败，没有事后修改原计划。

这些反例证明进程退出码和执行器自报不能替代独立验收。

## 真实成功证据

- 报告：`.real-smoke\REAL_CODEX_SMOKE_REPORT_001.json`
- Codex 发行包：`0.144.1-x86_64-pc-windows-msvc`
- Goal：`goal_b7490ccb07584cbebf7e`
- Plan：`plan_83fe91ffcf53425c94da`
- Approval：`approval_a66b5d4c5c6c4bffb9a5`
- Task：`task_19e6e586cdb3490c8d95`
- Run：`run_6d80b603468f4c06b5f8`
- Decision：`decision_9ba261a1056748e1a247`
- Codex duration：约 43 秒
- 变更集合：仅 `fixture.txt`
- 独立验收：通过
- 最终 Goal：`completed`
- 最终 Run：`accepted`
- Artifact：executor stdout、stderr、last message、verification report 共 4 份

## 下一门槛

进入 P3，但仍不连接现有业务项目：

1. 建立项目注册表和事实文件白名单。
2. 生成带来源哈希的最小上下文包。
3. 实现 L0-L3 风险分类和默认拒绝。
4. 禁止路径必须覆盖教师 PPT、069、070、凭据和未登记项目。
