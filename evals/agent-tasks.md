# Agent 任务级 eval 基线

`pnpm test:agent-eval` 运行 4 条可重复的任务契约：

1. 给项目制定研究计划时，Brief 的约束与成功标准必须进入 PI prompt。
2. 从历史失败经验中召回记忆时，必须按相关性而不是只按时间。
3. Agent 修改研究契约前必须审批，读取契约不需要。
4. 研究只读角色能读 Brief，但不能写 Brief；实验角色可以写。

这些任务不依赖真实模型：用真实 SQLite + 可控嵌入/AI 桩验证「任务完成所依赖的契约」。
真实模型接入后，同一组任务可直接作为回归基线；新增任务时在
`apps/server/src/eval/agent-task-eval.spec.ts` 追加一个 `it` 即可。

完整 prompt 契约（promptfoo）仍在 `pnpm eval:prompts`，两者互补：
前者测单轮 prompt 输出，后者测 Agent 任务链路。
