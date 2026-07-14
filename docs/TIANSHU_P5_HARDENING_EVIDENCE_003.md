# TianShu P5 加固与证据审计 003

更新时间：2026-07-14
状态：P5 真实隔离执行验收继续进行；不得声明产品完成。

## 本轮结论

本轮修复了跨 Agent 复核和 Job 生命周期中的三个实质缺口：

- 独立复核不再接受无结构的 `PASS` 文本。复核 Agent 必须返回 JSON，包含 `verdict=pass`、至少一个检查项、每项 `passed=true` 和非空证据说明。
- Windows 超时与取消改为通过 `taskkill /t /f` 回收整棵子进程树；非 Windows 使用进程组终止。
- 已成功、失败或取消的 Job 拒绝再次取消；只有运行中或已请求取消的 Job 可以结束，防止重复终态写入和伪造失败案例。

SQLite 仍是唯一机器状态源；本文只是可读证据。

## 可执行证据

命令：`npm test`

结果：47/47 通过，0 失败，0 跳过。

新增反例：

1. 纯文本 `PASS` 被拒绝，不能形成通过验证。
2. 终态 Job 不能再次取消或重复结束。
3. 原有超时重试、运行中取消、自审拒绝、失败执行不能被复核 PASS 翻转等测试继续通过。

## 既有证据审计

- `.real-smoke/state/tianshu-next.sqlite`：1 Goal、1 Run、1 Verification、1 Decision；最新状态为 `run.verification_failed` 后 `run.rejected`。
- `.p5-runtime/final-review-2.sqlite`：只有 1 条 Agent Run，没有 Goal、Run、Verification、Decision 完整链。
- 因此 `TIANSHU_P5_REAL_DISPATCH_ACCEPTANCE_001.md` 中“P5 100% 完成”不是当前可采信结论；该报告只证明当时的隔离样本曾运行，不能证明稳定产品闭环。
- P6 三课题隔离 PPT 仍只是验证样本，不代表 Teacher PPT 产品完成。

## 尚未关闭

- 需要在当前加固协议下重新运行一次真实隔离代码任务，并产生 Executor Agent Run、确定性 Git/字节证据、另一 Agent 的结构化复核、Verification 和 Creator Decision 的完整 SQLite 链。
- 需要长时间 Worker/重启恢复/子进程树回收的真实演练证据，而不只是自动测试。
- 正式 Obsidian Vault 路径未在仓库或配置中登记，当前不能安全回写；禁止猜测路径。
- GitHub 同步已尝试，但 `git push` 连接重置，随后 `git ls-remote` 无法连接 github.com:443；本地为 `main...origin/main [ahead 1]`，不得声明远端已同步。

## 下一阶段门

只有上述真实链条和演练通过后，才可由奈奈做 P5 关键确认。未经确认，不进入“P5 产品完成”表述。