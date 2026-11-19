import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Doc, KnowledgeDoc, Reference } from '../types';
import { qk } from './query-keys';

/**
 * 项目级列表 hook：页面不再各自拼 queryKey / queryFn。
 *
 * 迁移策略：先让新页面用 hook，旧调用可保留；同一个 key 下 React Query 自动去重。
 * 失败语义与旧代码一致（默认抛出，由页面决定是否 `retry: 0` / 降级）。
 */
type ListOptions = {
  enabled?: boolean;
  staleTime?: number;
  retry?: number;
  refetchInterval?: number | false;
};

export function useProjectDocs(projectId: string, options: ListOptions = {}) {
  return useQuery<Doc[]>({
    queryKey: qk.docs(projectId),
    queryFn: () => api.documents.list(projectId),
    ...options,
  });
}

export function useProjectRefs(projectId: string, options: ListOptions = {}) {
  return useQuery<Reference[]>({
    queryKey: qk.refs(projectId),
    queryFn: () => api.references.list(projectId),
    ...options,
  });
}

export function useProjectKnowledge(projectId: string, options: ListOptions = {}) {
  return useQuery<KnowledgeDoc[]>({
    queryKey: qk.knowledge(projectId),
    queryFn: () => api.knowledge.list(projectId),
    ...options,
  });
}
