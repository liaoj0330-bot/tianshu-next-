# TianShu 本机产品化搭建计划 004

更新时间：2026-07-14
状态：可实施架构基线
范围：仅 TianShu Next、本机运行时与 AgentHub 接入；Teacher PPT、069、070、业务仓库继续隔离。

## 1. 可行性结论

当前电脑可以搭建天枢的可用初级产品：一个常驻 Orchestrator、一个 SQLite 主状态库、AgentHub 与本地 Web 两个入口、四 Agent 受控调度、每晚回顾、项目变化判断、审批和 Vault 只读镜像，以及 14 至 30 天连续试点。

本机基线：Windows 11 64 位、i5-12500H 12 核 16 线程、约 16GB 内存、D 盘约 102GB 可用；Node 22.22.3、Python 3.13.14、Git 2.53；Codex、Claude、Hermes、OpenClaw CLI 均存在。审计时空闲内存约 3GB，因此默认并发上限为 2，即一个 Executor 加一个 Reviewer。

当前不适合同时常驻大量 Agent 或本地大模型、无限保存全天音视频，或在没有隐私策略时接入摄像头和联系人数据。

## 2. AgentHub 评估

结论：保留 AgentHub，但只作为奈奈的交互壳和渠道入口，不作为天枢大脑或状态数据库。

适合承担：

- 文字、语音和移动端入口；
- 展示今天、我、项目和确认中心的卡片或链接；
- 展示任务进度与 Agent 回传；
- 接收接受、纠正、拒绝、批准和取消。

不能承担：

- 保存第二套人物、项目、审批和任务状态；
- 绕过 Orchestrator 直接调用 Agent；
- 判断 Goal 完成；
- 用聊天记录代替长期状态模型。

现有 src/gateway/agenthub-adapter.mjs 只有一次 POST /v1/intake，属于连通样例。产品版必须补充 actor_id、conversation_id、message_id、idempotency_key、事件签名、异步状态回执、审批动作、任务进度和断线恢复。

先做两天 Integration Spike。AgentHub 能稳定传递消息、卡片动作和进度链接，就作为主入口；如果回调能力不足，保留聊天入口，复杂确认使用 TianShu Web。

## 3. 目标架构

输入层：AgentHub、TianShu Web、手机事件和未来硬件。

控制链：

Channel Adapter
→ TianShu Gateway
→ Intake、身份和会话解析
→ Observation 与变化理解
→ Goal Manager、风险门和审批
→ Durable Scheduler 与 Worker Supervisor
→ Codex、Claude、Hermes、OpenClaw
→ Artifact 与独立验证
→ 奈奈关键确认
→ SQLite
→ Vault 镜像、Dashboard 和通知。

硬边界：

- 所有状态写入只能经过 Orchestrator。
- AgentHub、Web、Agent、Vault 不直接写 SQLite。
- Executor 只能产生候选结果。
- Reviewer 必须与 Executor 不同，且不能替代确定性检查。
- 对外发送、发布、付款和联系人消息默认 L3，必须由奈奈批准。
- 项目只能访问 SQLite 登记的精确路径。
- Teacher PPT、069、070 写进 deny policy，不依赖提示词。

## 4. 需要新增的 SQLite 模型

observations：保存一次真实观察，不直接当作事实。字段包括来源、时间、原始 artifact、内容 hash、隐私等级和处理状态。

extracted_signals：候选变化，包含类型、陈述、时间范围、置信度、工作或生活域、受影响实体和证据。

entities 与 relations：在 SQLite 中形成可时间化的人物、项目、组织和关系图，包含 valid_from、valid_to、置信度和证据；不引入第二套图数据库。

commitments：统一工作和生活承诺，包含截止时间、重要性、状态和外部动作风险。

interaction_sessions：关联 AgentHub 与其他入口的会话和消息。

outbound_actions：保存对外动作草稿、对象、风险、审批和发送结果。

schedules：保存晚间 20:00 回顾、重试和下次运行时间。

## 5. 核心交互

普通输入：

接收消息
→ 去重并保存 Observation
→ 判断事实、变化、情绪、承诺、问题或指令
→ 与当前 Snapshot 和项目状态比较
→ 形成 change set
→ 信息不足时最多追问三个高价值问题
→ 生成状态提案或 Goal
→ 奈奈确认后更新。

每天 20:00：

1. Scheduler 创建 daily-review Job。
2. 汇总当天观察、任务、日程和项目变化。
3. 信息不足时通过 AgentHub 问一个开放问题。
4. 奈奈通过文字或语音回答。
5. 系统最多追问三个不重复问题。
6. 生成今日变化、影响、明日唯一动作、可代办事项和需确认事项。
7. 奈奈接受、纠正或拒绝。
8. 接受后事务性生成新 Snapshot 和 Vault 镜像。
9. 未回应时保持 pending，不推测当天状态。

项目变化：

新变化
→ 查找受影响项目和长期目标
→ 判断项目阶段是否改变
→ 使过期建议失效
→ 重新计算优先级建议
→ 奈奈确认
→ 生成执行 Goal
→ 多 Agent 执行
→ 确定性验证和跨 Agent 结构化复核
→ 奈奈接受或拒绝。

联系人第一版只做提醒和草稿，未经奈奈批准不发送。

## 6. 开发阶段

### M0 运行时固定化，2 至 3 天

新增 app/service、runtime-config、supervisor、Windows 安装和 health-check。固定正式 SQLite 与 artifact 路径；实现单实例锁、启动迁移、lease 对账、优雅关闭、并发上限 2、Agent 超时和每日备份。

阶段门：服务重启后状态不丢，运行中 Job 进入 recovery_required。

### M1 AgentHub Adapter v2，3 至 5 天

新增 channels/agenthub/server、auth、cards 和 session-store。实现消息、动作、Job 查询、事件流和决策卡接口。

阶段门：同一 message_id 重发只产生一次 Intake；AgentHub 断线重连看到同一 Job。

### M2 观察与变化理解，5 至 8 天

新增 observations/ingest、signal-extractor、state/change-engine、temporal-graph 和 relevance-selector。

阶段门：重复信息不重复入库；一次情绪不变成长期人格；重大项目变化使旧建议失效。

### M3 晚间回顾 MVP，4 至 6 天

新增 scheduler/daily-review、follow-up-policy 和 daily-card。

阶段门：三天工程回放后进入 14 天奈奈真实试点；未回应不自动修改状态。

### M4 项目判断与多 Agent 执行，7 至 10 天

新增 change-impact、priority-engine、agent-selector 和 composite-verifier。

阶段门：一个全新隔离项目完成成功、假成功、失败、取消、超时和重试六种路径。

### M5 产品界面，6 至 10 天

把现有单页 Dashboard 改为今天、我、项目、确认中心、运行与证据。AgentHub 保留快速输入、通知和卡片动作，复杂审阅跳转本地 Web。

阶段门：奈奈不看 SQLite 或命令行，也能完成一天的输入、纠正、审批和验收。

### M6 Vault 镜像，3 至 5 天

正式 Vault 路径必须由奈奈登记；只从 SQLite 原子生成 Markdown，保存 manifest 和 hash，可重建、可回滚；Markdown 不能反向修改机器状态。

阶段门：删除镜像后能从 SQLite 重建，篡改 Markdown 不改变系统状态。

### M7 真实试点，14 至 30 天

依次试点晚间变化理解、一个全新隔离项目、三位亲密关系的提醒与草稿。记录接受率、纠正率、重复问题率、错误长期记忆率、主动建议采纳率、每日操作时间、失败恢复率和越权动作数。

阶段门：越权外部动作数必须为 0，由奈奈决定是否进入下一阶段。

## 7. 可以实现到什么程度

四周目标：常驻总控、AgentHub 主入口、每晚回顾、人物状态变化、一个隔离项目多 Agent 闭环、本地确认中心、Vault 只读镜像。这是个人 AI 工作操作系统 Alpha，约为最终形态的 60% 至 65%。

八至十二周并完成 30 天真实试点：稳定主动回顾、项目变化驱动、受控关系维护、工作生活统一承诺、多 Agent 证据闭环和 Windows 常驻恢复。这是可日常使用 Beta，约为最终形态的 75% 至 80%。

剩余部分主要是未来硬件、多模态持续感知、真实日程联系人消息渠道和长期使用校准，当前不能虚报完成。

## 8. 立即开发顺序

1. M0：建立唯一正式运行实例，结束多个测试 SQLite 不能代表正式状态的问题。
2. AgentHub 两天 Spike：确认消息、动作和进度能力。
3. M1 与 M2：每条输入先成为 Observation，再判断变化。
4. M3：开始 14 天晚间真实试点。
5. 试点期间完成 M4，但只使用全新隔离项目。
6. 核心闭环稳定后完成 M5、M6，避免只有漂亮面板而没有大脑。