# 天枢 AgentHub / Today 交互契约阶段证据 001

## 1. 阶段目标

本阶段把 AgentHub 固定为奈奈使用天枢的统一交互与呈现入口，同时保证它不是第二状态源、确认者或执行者。所有输入、会话、幂等请求、待确认事项和恢复信息仍以 SQLite 为唯一机器状态真相源。

## 2. 已实现范围

### SQLite 交互状态

新增版本化迁移 `agenthub_interaction_contract`，持久化：

- `interaction_sessions`：AgentHub 会话、对话标识和创建者身份声明；
- `interaction_requests`：消息标识、幂等键、请求哈希、处理状态、对应 intake 和响应快照；
- 会话身份不可修改、正式会话不可删除的数据库约束；
- `channel + message_id` 与 `channel + idempotency_key` 唯一约束。

### 单一 intake 处理链

`/v1/intake` 与 AgentHub 消息入口复用同一个内部 intake 流程。AgentHub 不会另建一套工作区分类、判断、状态候选或行动候选逻辑。

### AgentHub 接口

- `POST /v1/channels/agenthub/messages`：提交创建者消息；
- `GET /v1/channels/agenthub/sessions/:session_id`：恢复会话、请求记录和当前 Today；
- `GET /v1/channels/agenthub/today`：读取 SQLite 生成的 Today 驾驶舱；
- 适配器提供提交消息、恢复会话和读取 Today 的调用函数。

### Today 表面契约

Today 明确披露：

- `state_authority = sqlite`；
- `decision_authority = nainai`；
- AgentHub 可以提交和呈现；
- AgentHub 不可以代替奈奈确认；
- AgentHub 不可以直接执行。

## 3. 关键不变量

1. 同一条 AgentHub 消息重复提交只返回原响应，不重复创建 intake。
2. 已使用的消息标识或幂等键不能代表另一条内容。
3. 会话、请求和 intake 在服务重启后仍能从同一 SQLite 恢复。
4. 只有 `actor_id=nainai` 且 `actor_kind=creator` 的可信边界声明能进入 AgentHub 正式消息入口。
5. 身份声明只证明内部契约已收紧，不等于外部 AgentHub 已完成密码学鉴权。
6. AgentHub 的提交权不包含计划确认权、执行确认权或最终验收权。
7. Today 是只读投影；待确认事项必须通过对应的受权决策接口写回 SQLite。

## 4. 可执行测试证据

专项门禁：

```powershell
node --test --test-concurrency=1 test/authority-migrations.test.mjs test/agenthub-contract.test.mjs test/workspace-assignment-gateway.test.mjs test/project-registry.test.mjs
```

结果：`14` 项通过，`0` 项失败，`0` 项跳过。

覆盖内容：

- migration v4 幂等执行；
- AgentHub 首次消息接收；
- 完全相同消息的幂等重放；
- 重用标识但修改内容时返回冲突；
- 非奈奈身份被拒绝；
- 会话、Today 和 intake 在 SQLite 重启后恢复；
- 既有工作区分类与原 AgentHub intake 路由保持有效。

全量回归：

```powershell
npm test
```

结果：`111` 项通过，`0` 项失败，`0` 项跳过。

## 5. 阶段边界

本阶段没有读取或修改 Teacher PPT、069、070 或业务项目仓库，也没有导入任何活跃项目的运行状态。

本阶段没有完成真实外部 AgentHub 的账号登录、签名校验、反向代理可信头或移动端/桌面端界面接线。当前 `actor_id` 和 `actor_kind` 是服务端契约校验，正式部署时必须由可信 AgentHub 网关注入，不能接受客户端自行声明。

本阶段也没有让 AgentHub 自动点击确认、启动 Executor、替代 Verifier 或代替奈奈最终验收。

## 6. 阶段结论

当前仓库已经具备 AgentHub 接入天枢所需的内部正式契约：统一 intake、创建者会话、消息幂等、SQLite 恢复和只读 Today。下一步如接入真实 AgentHub，应只做认证与界面适配，不应复制数据库或重建业务状态机。
