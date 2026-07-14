# TianShu Gateway × AgentHub 入口验收

日期：2026-07-14

## 结论

本机 Gateway 和 AgentHub 入口适配的最小闭环通过隔离测试。

## 已验证

- Gateway 健康检查；
- AgentHub 通过统一 HTTP 入口提交自然语言；
- 请求被标记为 `source=agenthub`；
- 请求被路由到 `tianshu-orchestrator`；
- SQLite 是唯一状态存储；
- Gateway 不保存第二套任务状态；
- 无效 JSON 和缺少 message 会被拒绝；
- 入口返回 intake_id，可继续关联 Goal/Task/Run。

## 验收证据

`npm test`：**27/27 通过**。

## 当前边界

- 当前 Gateway 是本机最小接口，不是公网服务；
- AgentHub UI 尚未直接改造为调用该接口；
- 手机和硬件尚未接入；
- 业务项目写入仍关闭；
- Teacher PPT、069、070 未读取、未修改、未派发。

## 架构裁定

AgentHub 作为入口和展示层；TianShu Orchestrator 作为唯一总控、任务状态和调度中心。未来手机和硬件也必须通过 Gateway 接入，不能直接连接 Agent 或写入状态。
