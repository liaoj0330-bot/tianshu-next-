# 天枢判断与经验生命周期 Phase 2 证据 001

## 阶段目标

补全“奈奈确认结果 -> 经验版本化 -> 后续判断引用 -> 奈奈评价实际影响 -> 反例触发失效或修订”的正式闭环。任何经验都不能因为系统生成、Executor 报告或 AgentHub 展示而自动成为有效规则。

## 已实现合同

- 判断反馈支持接受、纠正、拒绝、延后和忽略五种奈奈语义；忽略可独立检索，不与拒绝或延后混同。
- 经验首版和后续版本均为候选，只有奈奈可以激活或拒绝。
- 后续版本被拒绝或撤回时，当前有效版本保持不变。
- 经验可以被奈奈显式停用，也可以回滚到历史有效版本。
- 反例先作为候选；奈奈确认反例后，受影响的当前版本立即停止影响新判断。
- 反例导致经验停用后，新修订版本会显式携带全部已确认反例。
- 后续判断只能引用当前有效经验版本。
- 每次经验引用生成独立使用记录；判断完成后由奈奈评价为有帮助、有害、中性或不明确。
- Today 统一展示判断、结果、经验版本、经验反例和经验使用效果的待确认卡。
- Evolution 展示版本、生命周期、反例、引用记录和效果汇总。

## SQLite 证据

版本化迁移 `experience_lifecycle_governance` 新增：

- `judgment_feedback_extensions`；
- `experience_lifecycle_events`；
- `experience_counterexamples`；
- `experience_usage_evaluations`。

生命周期事件、反例内容和使用效果评价均为追加式记录，数据库触发器禁止原地改写或删除审计证据。

## 专项门禁

```powershell
node --test --test-concurrency=1 test\authority-migrations.test.mjs test\judgment-loop.test.mjs test\experience-lifecycle.test.mjs test\experience-lifecycle-gateway.test.mjs test\product-read-models-gateway.test.mjs
```

结果：`9` 项通过，`0` 项失败，`0` 项跳过。

门禁覆盖：

- 新版本拒绝不破坏当前有效版本；
- 新版本激活后旧版本被替代；
- 非奈奈身份不能回滚、确认反例或评价经验；
- 回滚恢复历史版本并记录来源版本；
- 已确认反例停止旧经验被后续判断引用；
- 修订版本显式携带反例；
- 撤回候选不影响当前版本；
- Today 确认队列与 Evolution 读模型展示完整生命周期；
- 忽略判断可独立检索；
- 经验使用效果评价完成后从待确认队列消失。

## 全量回归

```powershell
npm test
```

结果：`115` 项通过，`0` 项失败，`0` 项跳过。

## 阶段边界

本阶段证明了机器状态闭环和只读产品投影，不等于奈奈已经完成真实双循环。认知驾驶舱仍需把这些合同转化为无需查看 JSON 的可操作界面；真实改善仍须由奈奈在两次相似任务中验收。
