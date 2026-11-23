import { request } from './core';

export type SearchType = 'document' | 'chat' | 'project' | 'experiment' | 'reference' | 'knowledge';

export interface SearchHit {
  type: SearchType;
  id: string;
  title: string;
  snippet: string;
  score: number;
  route: string;
  updatedAt?: number;
}

export const search = {
  query: (projectId: string, q: string, types?: SearchType[]) => {
    const params = new URLSearchParams({ projectId, q });
    if (types?.length) params.set('types', types.join(','));
    return request<SearchHit[]>(`/api/search?${params.toString()}`);
  },
};
