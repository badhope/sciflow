# 研究循环提示词分支矩阵

> 目的：把「全自动科研」从一句口号变成可核对的分支清单。每个分支都要回答三个问题：**谁触发、提示词约束是什么、哪条测试证明它真的走到了**。
> 版本锚点：`v1.19.17` / `d9dc71b` + 本阶段未提交改动。

## 0. 工程规则

1. **提示词只描述角色与判定标准，不在提示词里写流程编排。** 编排在 LangGraph；提示词负责“怎么想”，图负责“什么时候走哪条边”。
2. **结构化输出一律 `generateObject + zod`。** 禁止手写 JSON 截取/正则修补；解析失败按 agent_error 处理，不静默兜底。
3. **mock 规则必须匹配真实提示词特征。** 统一匹配「最后一条 user message」中的显式标记（如 `【研究问题】`、`【协议设计】`），不得按 system prompt 猜。
4. **新增分支必须同时新增：图分支测试 + mock 规则（如走 mock）+ 本矩阵一行。** 只加代码不加证据，视为未完成。

## 1. 分支总表

| 分支 | 触发条件 | 提示词/契约 | 确定性行为 | 测试证据 |
| --- | --- | --- | --- | --- |
| 首轮计划 | cycle 启动，`iteration=0` | PI：逐字复述问题、可证伪假设、可执行协议；要求 120s 内、≤2000 条模拟记录 | 生成 hypothesis/protocol；进入 gate | `research-cycle.graph.spec.ts` 首轮 supported |
| 修订计划 | 上一轮 `refuted` 且未到上限 | PI 带 `priorFeedback + priorVerdict`，要求针对性改方案而不是换说法 | `iteration+1`，重新生成协议 | `结论 refuted 时走回边修订再来一轮` |
| 人工审批-放行 | `approvalMode=human`，gate interrupt | gate 节点只做审批，不在 interrupt 前产生副作用 | `resume(approved=true)` 后续跑 | `L2 门禁：人工批准后 resume 继续跑完` |
| 人工审批-驳回 | 同上，`approved=false` | 驳回原因不进入 PI 提示词（本轮直接终止） | `stopReason=approval_rejected`，不执行实验 | `L2 门禁：驳回协议即终止本轮` |
| AI 专家-放行 | `approvalMode=ai`，autonomy L3+ | 专家：独立判断协议是否可执行、是否越界；fail-closed | 直接进入 execute | `全自动模式：AI 专家批准后直接执行` |
| AI 专家-驳回后重写 | 专家返回 `approved=false` 且 `gateAttempts≤2` | 驳回理由写入 `gateFeedback`，PI 下一版必须补齐判定标准；最多重写 2 次 | `gateRoute=plan` → 新协议 → 再审批 | `AI 专家首次驳回后自动修订协议，第二次批准继续执行` |
| AI 专家-连续驳回 | 第 3 次仍 `approved=false` | 重写上限 `GATE_RETRY_LIMIT=2`，防止无限改写烧预算 | `approval_rejected`，不执行实验 | `AI 专家连续驳回，自动重写协议到上限后终止` |
| AI 专家-不可用 | 专家调用抛错/结构化失败 | 专家提示词失败不得默认放行 | `agent_error` → blocked | `AI 专家不可用时 fail-closed` |
| 实验成功 | 沙箱返回 `status=ok` 且 stdout 非空 | 实验者：把协议翻译成可执行 Python，必须 print 统计量 | 落 run/completed，进入 evaluate | `结论 supported 时一轮结束` |
| 实验脚本过短/无 print | 代码 <40 字符或无 `print(` | 实验者修复提示：完整脚本 + 关键统计量 | 首次记 failed，回灌修复一次 | `实验脚本只有 import / 没有 print` |
| 实验执行失败 | 沙箱 stderr / 超时 / 非 0 | 实验者带 `previousError` 修复一次 | 第二次仍失败 → `runFailed=true`，Critic 按证据不足处理 | graph spec 修复路径；S-02 待补 API 压测 |
| 评审 supported | Critic 返回 `verdict=supported` | Critic：quote 必须能在 stdout 找到；不得引用不存在的内容 | 生成 claim + evidence；decide 终止 | `结论 supported`；mock 评审 |
| 评审 refuted | Critic 返回 `verdict=refuted` | 同上；feedback/revisionHint 必填 | 回边修订；连续同方案同结论触发停滞 | `结论 refuted 回边`；`连续反驳停滞` |
| 评审 inconclusive | Critic 调用失败/输出不合规 | 不得伪造结论；按证据不足落库 | claim `inconclusive`，进入 decide | `critic.agent.spec.ts`；graph 评审异常用例 |
| 预算耗尽（计划后） | `tokensSpent >= maxTokens`，gate 前置 | 预算门在实验前，不允许“先跑再判” | `stopReason=budget_exceeded`，0 run | `计划阶段已超预算时，不进入实验执行` |
| 预算耗尽（实验后） | 实验完成但预算已超 | decide 优先预算，其次轮次/停滞 | `budget_exceeded` | `token 预算耗尽时终止` |
| 达到最大轮次 | `iteration >= maxIterations` | 终止原因优先级明确 | `max_iterations` | `达到最大轮次即终止` |
| 停滞 | 连续两轮方案指纹与结论均不变 | 方案指纹归一化，换说法不算改方案 | `stagnation` | `方案不变且结论不变时判定停滞` |
| 文献检索失败 | OpenAlex/Crossref 抛错 | 提示词只把文献当背景，不得当实验证据 | 降级为空线索，循环继续 | `文献检索失败时降级为空线索` |
| 服务重启-待审批 | 进程重启，cycle=`awaiting_approval` | 不自动跑，保留 checkpoint | 仍 awaiting；人工 resume 后才继续 | `research_cycle_restart_test.py` 人工审批 PASS |
| 服务重启-执行中 | 进程重启，cycle=`execute` 且有 checkpoint | 自动 `invoke(null)`；execute 重放按 cycle+protocol+iteration 找回 run | 已完成的 run 复用输出；未完成的复用同一 run 重跑 | `research_cycle_restart_test.py` 自动执行 PASS；`重启重放 execute 时复用已完成 run` |
| 服务重启-无 checkpoint | 进程重启，非终态但无 checkpoint | 不伪造续跑 | 标 blocked，保留已有 claims/runs | `research-cycle-recovery.spec.ts` 无 checkpoint blocked |
| 看门狗超时 | active 且超过 `RESEARCH_CYCLE_WATCHDOG_MINUTES` 无心跳 | 节点均上报 heartbeat | 标 blocked、释放锁、收尾 trace；忽略迟到返回值 | `research-cycle-recovery.spec.ts` 看门狗 active |
| 看门狗孤儿 | DB 非终态、无进程持有、updatedAt 过期 | 不误杀 awaiting | 标 blocked | `research-cycle-recovery.spec.ts` 看门狗 DB 孤儿 |
| 手动恢复 | blocked 且仍有 checkpoint | 只允许非执行态；无 checkpoint 拒绝 | `POST /recover` 续跑 | recovery spec + UI blocked 面板用例 |

## 2. 终止原因优先级

`gate 预算` → `人工/专家驳回` → `实验后预算` → `最大轮次` → `停滞` → `completed`。

> 为什么预算要放在 supported 之前：旧实现先判 `supported` 再判预算，导致 `maxTokens=1` 也能跑完实验并 synthesize。预算门必须在产生新成本之前。

## 3. 已知缺口

- **真实模型提示词 eval 未覆盖全部分支。** 当前 mock 分支全绿；真实模型只验证过主链（PI/实验者/Critic/专家），拒批、停滞、预算等分支仍以确定性 mock 为主。
- **S-02 API 级修复路径压测未补。** 图单测覆盖“首轮 SyntaxError → 修复成功”，但没有真实 HTTP + 沙箱的失败注入。
- **S-04 重启矩阵只覆盖 gate/execute。** plan/evaluate/revise 三个节点的 kill 恢复仍待补。
- **提示词版本没有独立版本号。** 目前随代码走；后续应给 PI/Critic/专家提示词加 `promptVersion`，写入 run manifest，便于复现。

## 4. 下阶段动作

1. 用真实模型跑「拒批/驳回/预算/停滞」四类分支，记录模型输出与终止原因。
2. 给 `research-cycle` 加失败注入开关（`MOCK_EXPERIMENT_FAIL_ONCE`），补齐 S-02。
3. 扩展 restart test 到 plan/evaluate/revise，补齐 S-04。
4. 提示词版本化：`promptVersion` 进入 run manifest 与质量报告。
