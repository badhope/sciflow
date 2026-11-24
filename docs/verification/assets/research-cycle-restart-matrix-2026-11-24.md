# 研究循环重启矩阵与边界验收（2026-11-24）

本记录对应 S-04 / R-07b / R-08 / S-02，全部在真实进程上执行：真实 SQLite、真实 HTTP、真实 Python 沙箱、真实 LangGraph；不使用图单测桩。

## 1. 五节点重启矩阵

脚本：`scripts/research_cycle_restart_test.py`

```bash
python3 scripts/research_cycle_restart_test.py \
  --port 4410 \
  --db /tmp/sciflow-restart6/sciflow.db \
  --log /tmp/sciflow-restart6/server.log \
  --delay-ms 3000 --plan-delay-ms 6000 --critic-delay-ms 6000
```

结果：5/5 PASS。

| 场景 | 注入点 | 结果 | 关键计数 |
| --- | --- | --- | --- |
| 人工审批挂起 | gate 等待人工 | kill → 重启仍 `awaiting_approval` → resume → `synthesize` | claims=1 / runs=1 / tokens=919 |
| 自动执行中 | execute | kill → 重启自动续跑 → `synthesize` | claims=1 / runs=1 / tokens=1502 |
| 计划阶段 | plan | kill → 重启自动续跑 → `synthesize` | claims=1 / runs=1 / tokens=1004 |
| 评审阶段 | evaluate | kill → 重启自动续跑 → `synthesize` | claims=1 / runs=1 / evidence=2 / tokens=1004 |
| 修订回边 | revise → plan | 首轮 refuted → 第二轮 plan kill → 重启自动续跑 | claims=2 / runs=2 / tokens=2018 |

结束健康检查：`active=0 / awaitingApproval=0 / blocked=0`。

### 评审重放为何会重复落库

LangGraph 的 checkpoint 在节点执行前提交，进程在 evaluate 中途被 `kill -9` 后，重启会从「evaluate 之前」重放整段评审。原实现每次都 `createClaim + addEvidence`，会产生两条结论或两组重复证据。

修复：

- `ResearchRecordsService.findClaim(programId, cycleId, protocolId)`：按 cycle + protocol 找回已有结论；
- `clearEvidence(claimId)`：重放时先清空旧证据，再整组重建；
- evaluate 节点复用已有 claim，仅更新假设陈述、置信度与状态，不再新增第二条结论；
- 图单测新增「重启重放 evaluate 时复用已有 claim，不重复落库且证据整组重建」。

## 2. 并发启动与修复路径

脚本：`scripts/research_cycle_edge_test.py`

```bash
python3 scripts/research_cycle_edge_test.py --port 4412 --root /tmp/sciflow-edge4
```

结果：2/2 PASS。

### R-08 同一 program 并发 start

- 8 个并发 `POST /research-cycles/start`；
- 结果：`201=1`、`400=7`；
- 7 个拒绝均返回「该研究项目已有循环在运行」；
- 最终 `GET /research-cycles?programId=` 只有 1 个 cycle；
- 循环结束后 `active=0`。

### S-02 语法失败自动修复

- 通过 `MOCK_EXPERIMENT_SYNTAX_ERROR_ONCE=1` 让实验者首次返回 `print("broken"`；
- 日志出现 `execute {"attempt":1,"ok":false}`；
- 同一 `runId` 第二次执行成功：`execute {"runId":"...","ok":true,"runtimeMs":124}`；
- 最终 `state=synthesize`、claims=1、runs=1、tokens=1008。

## 3. 同批次门禁

- server 单测：961 passed / 1 skipped（139 files）；
- web 单测：277 passed（51 files）；
- `scripts/full_regression.py`：237 PASS / 0 FAIL；
- `pnpm lint`：通过；
- server typecheck：通过。

## 4. 已知边界

- 计划/评审/修订重启依赖 `MOCK_PLAN_DELAY_MS` / `MOCK_CRITIC_DELAY_MS` 制造稳定 kill 窗口；生产环境不需要这些变量。
- 评审重放的证据采用「清空重建」而非增量追加；若未来引入人工批注证据，需要改为按来源去重，不能直接清空。
- 五节点矩阵仍使用 mock 角色；真实模型网关的间歇空响应问题见 `research-cycle-real-model-2026-11-24.md`，两者是不同层面的验证。
