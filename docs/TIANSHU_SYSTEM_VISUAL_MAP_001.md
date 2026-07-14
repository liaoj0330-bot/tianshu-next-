---
title: 天枢结构关系图
type: architecture-map
status: active
updated: 2026-07-15
state_authority: sqlite
tags:
  - 天枢
  - 系统结构
  - 可视化
  - 汇报
---

# 天枢结构关系图

> [!important] 一句话定位
> 天枢是奈奈的个人 AI 工作操作系统：理解长期身份与阶段变化，主动判断项目，受控调度多个 Agent，独立验收，长期运行，并把关键决定交给奈奈确认。

## 1. 产品认知结构

```mermaid
flowchart TB
    N["奈奈<br/>最终判断与关键确认"]
    T["天枢 Orchestrator<br/>理解、判断、计划、治理"]

    subgraph C["理解奈奈"]
      C1["长期身份与使命"]
      C2["当前状态与情绪"]
      C3["未来目标与变化"]
      C4["项目组合与优先级"]
    end

    subgraph A["受控行动"]
      A1["自然语言入口"]
      A2["判断 / 追问 / 状态候选"]
      A3["计划候选与版本"]
      A4["执行边界与第二次确认"]
    end

    subgraph G["治理与证据"]
      G1["Executor"]
      G2["Independent Verifier"]
      G3["失败 / 取消 / 超时 / 重试"]
      G4["证据报告与长期复盘"]
    end

    N --> C
    C --> T
    A1 --> T
    T --> A2 --> A3 --> A4
    N -.确认状态与计划.-> A2
    N -.确认执行边界.-> A4
    A4 --> G1 --> G2 --> G4
    G3 --> G4
    G4 --> T
    G4 --> N
```

## 2. 状态权威与界面关系

```mermaid
flowchart LR
    U["奈奈 / AgentHub / 手机 / 飞书"] --> API["TianShu Gateway"]
    API --> O["Orchestrator"]
    O --> DB[("正式 SQLite<br/>唯一机器状态源")]
    DB --> RM["产品读模型<br/>Today / Confirmations / Evidence"]
    RM --> AH["AgentHub 开发版"]
    RM --> OBS["Obsidian 可读镜像"]
    DB --> DISP["受控调度器"]
    DISP --> EX["Executor Agent"]
    EX --> VER["独立 Verifier"]
    VER --> DB

    OBS -.禁止反向改写机器状态.-> DB
    AH -.所有修改必须经 API 与确认.-> API
```

> [!warning] 权威规则
> SQLite 是唯一机器状态源。Obsidian 是汇报、理解和复盘界面；不能用手工修改 Markdown 直接改变任务、运行或审批状态。

## 3. 奈奈的真实用户路径

```mermaid
flowchart TD
    S["奈奈像平时一样说话"] --> I{"天枢识别输入性质"}
    I -->|问题/判断| J["给出判断、理由、不确定性、下一步"]
    I -->|证据不足| Q["只问一个最关键问题"]
    I -->|状态变化| SC["展示变化前后与影响"]
    I -->|想推进事情| PC["生成结构化计划候选"]
    SC --> SD{"奈奈接受 / 修正 / 拒绝"}
    PC --> PD{"奈奈确认 / 修改 / 暂不执行"}
    PD -->|确认计划| P["建立 Goal + Plan<br/>不启动 Agent"]
    P --> B["配置执行者、复核者、路径、超时、重试"]
    B --> ED{"奈奈第二次确认"}
    ED -->|批准| TASK["建立 Task<br/>仍不自动等于完成"]
    TASK --> RUN["受控执行与独立复核"]
    RUN --> E["展示证据、问题与下一决定"]
```

## 4. 双确认与独立验收

```mermaid
sequenceDiagram
    participant N as 奈奈
    participant T as 天枢
    participant DB as SQLite
    participant E as Executor
    participant V as Independent Verifier

    N->>T: 我想推进一件事
    T->>DB: 保存计划候选 v1
    T-->>N: 目标、完成标准、范围、风险
    N->>T: 修改或确认计划
    T->>DB: 保存新版本 / Goal / Plan
    Note over T,DB: 第一次确认后不启动 Agent
    T-->>N: 请求确认执行边界
    N->>T: 批准 executor、verifier、路径、超时、重试
    T->>DB: 创建受控 Task
    Note over T,DB: 第二次确认仍不代表任务完成
    T->>E: 按批准边界执行
    E-->>T: 输出、退出码、产物
    T->>V: 使用独立证据复核
    V-->>T: 结构化 PASS / FAIL + evidence
    T->>DB: 保存 Run、Verification、Decision
    T-->>N: 发生了什么、证据是什么、下一步是什么
```

## 5. 六阶段能力地图

```mermaid
flowchart LR
    P1["P1 认识奈奈<br/>基础完成"] --> P2["P2 理解变化<br/>基础完成"] --> P3["P3 主动项目辅助<br/>基础完成"] --> P4["P4 长期运行治理<br/>基础完成"] --> P5["P5 统一调度与真实隔离<br/>真实任务验收中"] --> P6["P6 交互/镜像/试点<br/>开发版集成中"]

    classDef done fill:#1f6f5f,color:#fff,stroke:#58d6b3;
    classDef active fill:#5d4f1f,color:#fff,stroke:#f1c75b;
    classDef next fill:#30364b,color:#fff,stroke:#8b8cf7;
    class P1,P2,P3,P4 done;
    class P5 active;
    class P6 next;
```

## 6. 结构层级

| 层级 | 作用 | 当前载体 |
| --- | --- | --- |
| 创造者模型层 | 身份、使命、目标、偏好、边界 | `00_创造者模型` + SQLite 状态快照 |
| 判断与项目层 | 判断资产、项目组合、量化优先级 | SQLite + `04_判断资产卡库` |
| 产品交互层 | 今日重点、追问、候选、确认 | AgentHub TianShu Today |
| 计划治理层 | Goal、Plan、版本、双确认 | TianShu Orchestrator |
| 执行验收层 | Executor、Verifier、证据与终态 | 受控调度器 + SQLite |
| 汇报镜像层 | 进度、结构图、复盘、导航 | 本 Obsidian Vault |

## 7. 防污染与停止规则

- 上层已确认事实优先于历史材料和模型推断。
- 未确认变化只能作为候选，不能直接成为正式状态。
- 未登记项目不猜测；`no_access` 项目即使命中也禁止执行。
- Executor 退出码成功不能替代 Git、产物、范围与独立复核证据。
- 样本验证不能写成产品完成。
- 受保护项目保持隔离，不读取、不修改、不派发。

## 8. 汇报入口

- [[06_项目记忆层/02_天枢个人智能操作系统/TIANSHU_NEXT_CURRENT_PROGRESS_001|天枢当前进度与证据仪表板]]
- [[06_项目记忆层/02_天枢个人智能操作系统/项目记忆首页|天枢项目记忆首页]]
- [[00_从这里开始_天枢工作台|返回天枢工作台]]