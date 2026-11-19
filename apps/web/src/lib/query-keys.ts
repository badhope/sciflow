/**
 * React Query key 单一事实源。
 *
 * 为什么集中：此前同一个 `documents.list` 在 7 个页面用了 `['docs']`、`['dash']`、
 * `useEffect` 三种方式；`references.list` 出现 `['references']` / `['refs']` / `['kb-refs']`
 * 三个 key，切页重复拉取且失效不同步。新增 key 一律写在这里，页面禁止再拼字符串。
 *
 * 命名约定：
 *  - 列表：`['docs'|'refs'|'knowledge-docs'|'pipeline', projectId]`
 *  - 详情：`['doc', docId]`
 *  - Agent：`['agent-metrics'|'agent-plans'|'agent-approvals'|'agent-tasks', projectId]`
 */
export const qk = {
  docs: (projectId: string) => ['docs', projectId] as const,
  doc: (docId: string) => ['doc', docId] as const,
  refs: (projectId: string) => ['refs', projectId] as const,
  knowledge: (projectId: string) => ['knowledge-docs', projectId] as const,
  pipeline: (projectId: string) => ['pipeline', projectId] as const,
  experiments: (projectId: string) => ['experiments', projectId] as const,
  pipelineTask: (taskId: string) => ['pipeline-task', taskId] as const,

  agentMetrics: (projectId: string) => ['agent-metrics', projectId] as const,
  agentPlans: (projectId: string) => ['agent-plans', projectId] as const,
  agentApprovals: (projectId: string) => ['agent-approvals', projectId] as const,
  agentTasks: (projectId: string) => ['agent-tasks', projectId] as const,
};
