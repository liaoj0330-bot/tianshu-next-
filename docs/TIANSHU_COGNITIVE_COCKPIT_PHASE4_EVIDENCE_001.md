# 天枢认知驾驶舱 Phase 4 证据 001

## 阶段目标

让奈奈不查看 SQLite、终端输出或原始 JSON，也能完成输入、理解判断、纠正、计划确认、执行授权、结果验收和经验评价。AgentHub 继续作为统一交互入口，并可深链打开本地驾驶舱的指定确认卡。

## 已实现视图

- **Today**：自然语言输入、唯一焦点、当前约束、执行摘要、统一确认中心、最近记录；
- **Decision**：事实、推断、不确定性、建议、奈奈反馈和折叠审计详情；
- **Action**：计划门禁、执行状态、独立验证、最终验收、异步任务取消/重试/恢复；
- **Evolution**：经验当前版本、来源、反例、引用次数、使用效果和生命周期时间线。

## 交互边界

- 原始 JSON 只出现在折叠的“查看审计详情”，不是主界面；
- 每张确认卡先展示提交后果，再显示奈奈操作；
- 判断支持接受、纠正、拒绝、延后、忽略；
- 状态纠正通过可读字段编辑后生成完整 `corrected_state`；
- 计划确认、执行边界配置、执行授权和最终验收是不同步骤；
- 取消不会被记录为成功；失败与恢复任务只有奈奈能重试；
- AgentHub 不能调用确认权，可通过 `/dashboard?confirmation=:confirmation_id` 打开指定确认卡；
- 断线、空状态、失败、恢复和长文本均有明确界面状态。

## 自动化证据

专项门禁覆盖：

- 驾驶舱 HTML、四视图和浏览器脚本语法；
- 带查询参数的确认深链；
- AgentHub 的驾驶舱与确认链接合同；
- 异步任务取消、失败重试、服务恢复与奈奈权限；
- AgentHub 和缺失身份均不能操作任务控制；
- Today、判断、经验和活动读模型保持 SQLite 单一状态源。

全量回归：

```powershell
npm test
```

结果：`116` 项通过，`0` 项失败，`0` 项跳过。

## 视觉证据

使用本机 Edge 无头模式，在隔离 SQLite 预览状态上完成目视检查：

- `acceptance/cockpit_today_desktop.png`；
- `acceptance/cockpit_today_mobile.png`；
- `acceptance/cockpit_decision_desktop.png`；
- `acceptance/cockpit_action_desktop.png`；
- `acceptance/cockpit_evolution_desktop.png`；
- `acceptance/cockpit_confirmation_modal_desktop.png`。

检查结果：桌面和 500px 移动视口无导航缺失、文本遮挡或控件越界；长问题正常换行；确认模态完整显示后果、五类判断反馈、理由和审计详情。

## 阶段边界

本阶段没有连接或修改外部 AgentHub 仓库，没有读取 Teacher PPT、069、070 或业务项目，也没有把预览数据写入正式状态。

工程门禁通过不等于真实个人试点完成。下一门必须由奈奈用两次相似、低外部风险的真实任务完成：第一次留下判断、反馈、结果与经验；第二次明确引用该经验，并由奈奈确认是否减少决策时间、重复解释或建议不适配。
