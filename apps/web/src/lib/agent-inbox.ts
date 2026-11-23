import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { qk } from './query-keys';

/**
 * Agent 任务清单 + 待审批收件箱单一入口。
 *
 * 此前 WorkspacePage 与 AgentOpsPanel 各自调用 `agent.tasks / pendingApprovals /
 * decideApproval`，queryKey 与轮询间隔也不同；同一个审批可能在两个页面重复渲染。
 * 这里统一 key、轮询与失效，组件只负责展示与 toast。
 */
export function useAgentInbox(
  projectId: string,
  options: { tasksInterval?: number; approvalsInterval?: number; notificationsInterval?: number } = {},
) {
  const qc = useQueryClient();
  const tasksQuery = useQuery({
    queryKey: qk.agentTasks(projectId),
    queryFn: () => api.agent.tasks(projectId),
    retry: 0,
    refetchInterval: options.tasksInterval ?? 4000,
  });
  const approvalsQuery = useQuery({
    queryKey: qk.agentApprovals(projectId),
    queryFn: () => api.agent.pendingApprovals(projectId),
    retry: 0,
    refetchInterval: options.approvalsInterval ?? 3000,
  });
  const notificationsQuery = useQuery({
    queryKey: qk.agentNotifications(projectId),
    queryFn: () => api.agent.notifications(projectId, 20),
    retry: 0,
    refetchInterval: options.notificationsInterval ?? 5000,
  });
  const markNotificationRead = useMutation({
    mutationFn: (id: string) => api.agent.markNotificationRead(id, projectId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.agentNotifications(projectId) }),
  });
  const markAllNotificationsRead = useMutation({
    mutationFn: () => api.agent.markAllNotificationsRead(projectId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.agentNotifications(projectId) }),
  });
  const retryNotification = useMutation({
    mutationFn: (id: string) => api.agent.retryNotification(id, projectId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.agentNotifications(projectId) }),
  });
  const decideApproval = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) => api.agent.decideApproval(id, approved),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.agentApprovals(projectId) });
    },
  });
  const decidePlan = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) => api.agent.decidePlan(id, approved),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.agentPlans(projectId) });
      void qc.invalidateQueries({ queryKey: qk.agentApprovals(projectId) });
      void qc.invalidateQueries({ queryKey: qk.agentMetrics(projectId) });
    },
  });

  return {
    tasksQuery,
    approvalsQuery,
    notificationsQuery,
    markNotificationRead,
    markAllNotificationsRead,
    retryNotification,
    decideApproval,
    decidePlan,
    invalidate: () => {
      void qc.invalidateQueries({ queryKey: qk.agentTasks(projectId) });
      void qc.invalidateQueries({ queryKey: qk.agentApprovals(projectId) });
      void qc.invalidateQueries({ queryKey: qk.agentNotifications(projectId) });
    },
  };
}
