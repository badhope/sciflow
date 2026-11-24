# 长跑 Agent 的崩溃点不在 Prompt，在状态机

先讲一个不太体面的现场。

我把 SciFlow 的研究循环跑到 `execute`，沙箱里的 Python 还在算 bootstrap，终端突然被 `kill -9`。重启服务后，数据库里躺着一个 `state=running` 的 cycle，进程没了，锁还在。前端一直转圈，API 每次都说“该研究项目已有循环在运行”。那一刻我才意识到，长跑 Agent 最先崩的从来不是 Prompt，是状态机。

## 一次 HTTP 请求装不下一轮科研

聊天 Agent 的默认假设是：请求进来，模型回一段，结束。研究循环不是这样。

一轮完整的循环要经过 PI 写协议、专家门禁审批、沙箱执行、Critic 评审、可能的修订回边。每一段都可能停几分钟，审批甚至可能停几个小时。用户关掉浏览器、服务重启、模型网关超时，都是正常事件，不是异常。

所以第一版把 `running` 放在内存 `Set` 里，看着很轻，实际很脆。进程一死，锁不会跟着死；数据库里的状态还停在 `running`，但没有任何执行者。下一次启动，它就成了幽灵。

## 把断点放回业务数据库

现在的 checkpoint 和业务表在同一个 SQLite。不是“为了本地优先”这种口号，而是因为断点和 cycle/claim/run 必须一起备份、一起迁移、一起审计。你把数据库拷走，恢复的不只是聊天记录，还有“这一轮跑到哪、下一步该谁接手”。

启动时不再假设内存是真相。`onModuleInit` 先扫非终态循环：

```ts
// apps/server/src/research-cycle/research-cycle.service.ts
recoverInterrupted(): { resumed: number; blocked: number; waiting: number } {
  const rows = db.select().from(researchCycles)
    .where(inArray(researchCycles.state, [...RECOVERABLE_STATES, 'awaiting_approval']))
    .all();

  for (const cycle of rows) {
    if (cycle.state === 'awaiting_approval') continue; // 审批挂起，不自动跑
    if (!this.hasCheckpoint(cycle.id)) {
      this.programs.updateCycle(cycle.id, { state: 'blocked', summary: '服务重启：未找到断点' });
      continue;
    }
    void this.invoke(cycle.id, program.projectId, null); // 从最后提交的节点续跑
  }
}
```

这里有个容易写错的细节：`awaiting_approval` 不能自动续跑。它是在等人，不是在等进程。启动恢复把它当成“待审批”保留，人批准后才用 `Command({ resume })` 接着走。否则服务一重启，AI 就替人把协议批了。

## 看门狗不是万能重启，它只负责释放锁

有断点还不够。有些节点会卡在外部调用上，进程没死，但心跳没了。我们加了一个 cycle 级看门狗，默认 60 分钟没有节点心跳就：

1. 把 cycle 标成 `blocked`，写清“超过 N 分钟无心跳”；
2. 结束对应的 run trace，状态记 `error`；
3. 释放内存和数据库里的运行锁；
4. 保留 checkpoint，允许人从断点手动 `/recover`。

它不会自动重跑。自动重跑听起来很智能，实际会把一个可能已经跑了一半的沙箱再跑一遍，把 token 再烧一遍。长跑系统里，“停下来等人”比“猜着继续”便宜。

## 重放节点必须幂等

LangGraph 从 checkpoint 恢复时，会从最后一个已提交节点之后重放。也就是说，`execute` 和 `evaluate` 可能再执行一次。

`execute` 的幂等键是 `cycleId + protocolId + iteration`。重放时先找同一轮已完成且有 stdout 的 run，有就直接复用；没有就复用中断前的 run 记录重跑，不新建一条“看起来像第二次实验”的记录。

`evaluate` 更容易出错：如果直接 `createClaim`，重启一次就会多一条 claim，证据也会翻倍。现在的做法是按 `cycle + protocol` 找已有 claim，先清空旧证据，再整组重建。这样无论重放几次，最终只有一条结论、一组证据。

```ts
const existingClaim = deps.records.findClaim(s.programId, s.cycleId, s.protocolId);
if (existingClaim) {
  deps.records.clearEvidence(existingClaim.id);
  deps.records.updateClaim(existingClaim.id, { status: verdict.verdict, confidence: verdict.confidence });
  claim = existingClaim;
} else {
  claim = deps.records.createClaim(...);
}
```

这段代码不优雅，但它解决的是“同一轮评审出现两条结论”这种审计灾难。

## 真实测试打了哪些洞

不是只跑单测。我们用真实进程做过几类破坏：

- 审批中 `kill -9`，重启后必须仍停在审批，不能自动批准；
- 执行中 `kill -9`，重启后从 checkpoint 续跑，不能留下永久 `running`；
- 删除 checkpoint 后重启，必须标 `blocked` 并保留已有 claim/run；
- 20 轮并发启动 + 5 个边界场景，25/25 通过；
- 五节点重启矩阵 5/5 通过；
- 全量 server 972 passed / 1 skipped，web 277 passed。

这些数字不漂亮，但它们比“我的 Agent 很智能”有用。

## 还有哪些没解决

- 真实模型网关仍会空响应。我们做了结构化输出归一化和模型降级链，但上游稳定性不在我们手里。
- 看门狗默认 60 分钟，对超长沙箱任务可能偏保守；目前通过环境变量调。
- 内存锁 + 数据库状态仍是双写，极端情况下需要看门狗兜底；彻底方案是数据库 advisory lock，但 SQLite 单机场景下收益有限。
- 大文件还没拆完：`pipeline.service.ts` 仍有 731 行，`database.ts` 873 行。

长跑 Agent 的难度，不在把 Prompt 写得多长，而在你敢不敢让它跑一夜，第二天回来还能解释清楚每一分钱 token 花在哪、每一步为什么停、停了之后从哪里接上。

SciFlow 1.19.18 的代码和真实闭环证据在：<https://github.com/badhope/sciflow>

如果你也在写长跑 Agent，先别急着加工具。把 `kill -9` 按下去，看看你的状态机能不能自己站起来。
