# TianShu M0 正式运行时验收报告 001

更新时间：2026-07-14
结论：M0 代码与本机部署阶段门通过。该结论只覆盖正式运行时底座，不代表 AgentHub v2、变化理解、晚间回顾或最终产品完成。

## 已实现

- 唯一正式运行根目录：.tianshu-runtime。
- 唯一正式 SQLite：.tianshu-runtime/state/tianshu.sqlite。
- 测试、P5 和 real-smoke SQLite 不再被当作正式状态。
- 单实例文件锁；存活实例拒绝重复启动，异常遗留锁可恢复。
- 启动时把中断 Run 转为 recovery_required。
- 启动时立即回收上一服务遗留的 active lease、项目锁和 Job，不等待 lease 自然过期。
- Worker Supervisor 并发上限默认为 2，同一项目继续受项目锁串行保护。
- 未知 Job 类型、处理失败和超时进入既有失败/重试状态机。
- 每日 SQLite 备份、SHA-256 manifest 和默认 14 份保留上限。
- 结构化健康接口包含 PID、uptime、Worker 状态、活动数、并发上限、恢复数和最近备份摘要。
- npm service、npm health、Windows 安装和卸载脚本。
- 服务仅绑定 localhost；远程绑定必须显式开启。
- SIGINT、SIGTERM 优雅关闭路径。

## 本机部署事实

Windows 计划任务注册因 Access is denied 未成功。安装器按设计降级为当前用户 HKCU Run 登录启动项，不需要管理员权限。

当前服务：

- 地址：http://127.0.0.1:4317
- 状态：ok
- Worker：running
- max_concurrency：2
- SQLite：唯一正式状态源
- 登录启动：HKCU Run / TianShuNext
- 服务隐藏启动，不创建可见控制台窗口

## 可执行证据

M0 聚焦测试：6/6 通过。

全量命令：npm test

结果：53/53 通过，0 失败，0 跳过。

真实启动演练返回：

- control_plane = tianshu-orchestrator
- state_store = sqlite
- worker.running = true
- worker.max_concurrency = 2
- last_backup_sha256 为 64 位 SHA-256

真实正式实例已启动并持续通过健康检查。

## 边界与下一步

- 尚未安装 AgentHub Adapter v2。
- 尚未确认 AgentHub 的消息动作、审批卡片和进度回调能力。
- 正式 Vault 路径仍未登记，因此 M0 不写 Vault。
- 下一阶段严格进入 AgentHub Integration Spike；未通过 Spike 前不把 AgentHub 宣称为产品主入口。
- Teacher PPT、069、070 与业务仓库未读取、未修改、未派发。