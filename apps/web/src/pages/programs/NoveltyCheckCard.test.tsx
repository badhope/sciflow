import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { NoveltyCheckResult } from '../../types';
import { NoveltyCheckCard } from './NoveltyCheckCard';

vi.mock('../../api/client', () => ({
  api: { research: { noveltyCheck: vi.fn() } },
}));

const check = vi.mocked(api.research.noveltyCheck);

function result(over: Partial<NoveltyCheckResult> = {}): NoveltyCheckResult {
  return {
    status: 'offline',
    enabled: true,
    offline: true,
    basis: 'offline-fallback',
    overlap: 0,
    specificity: 42,
    similar: [],
    advice: '本地库未发现明显重复，选题具备一定特异性。',
    notice: '公开学术源全部不可达。国内网络直连境外 API 可能需要代理；可先改用本地文献库、DOI / BibTeX 导入。',
    sources: [
      { source: 'openalex', ok: false, success: 0, failed: 1, error: '网络不可达' },
      { source: 'crossref', ok: false, success: 0, failed: 1, error: '网络不可达' },
      { source: 'arxiv', ok: false, success: 0, failed: 1, error: '网络不可达' },
    ],
    hitCount: 0,
    ...over,
  };
}

describe('NoveltyCheckCard', () => {
  beforeEach(() => check.mockReset());

  it('离线降级时明确写本地重叠度与代理提示，不伪装成联网查新', async () => {
    check.mockResolvedValue(result());
    render(<NoveltyCheckCard projectId="p1" />);

    fireEvent.change(screen.getByLabelText('选题'), { target: { value: '异质图节点分类的鲁棒性' } });
    fireEvent.click(screen.getByRole('button', { name: '开始查新' }));

    expect(await screen.findByText('离线降级')).toBeTruthy();
    expect(screen.getByText(/本地重叠度/)).toBeTruthy();
    expect(screen.getByText(/可能需要代理/)).toBeTruthy();
    expect(screen.getByText('OpenAlex 不可达')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('有结果时可把选题带入立项表单', async () => {
    const onUseTopic = vi.fn();
    check.mockResolvedValue(
      result({
        status: 'degraded',
        offline: false,
        basis: 'scholar',
        overlap: 80,
        specificity: 49,
        hitCount: 14,
        notice: '部分公开学术源不可达（OpenAlex），已返回 14 条。',
        sources: [
          { source: 'openalex', ok: false, success: 0, failed: 1, error: '网络不可达' },
          { source: 'crossref', ok: true, success: 1, failed: 0 },
          { source: 'arxiv', ok: true, success: 1, failed: 0 },
        ],
        similar: [
          {
            title: 'Sorted Graph Neural Network for Robust Node Classification on Heterophilic Graphs',
            year: 2025,
            venue: '',
            doi: '10.2139/ssrn.5336704',
            url: 'https://doi.org/10.2139/ssrn.5336704',
            source: 'crossref',
            citationCount: 0,
          },
        ],
      }),
    );
    render(<NoveltyCheckCard projectId="p1" onUseTopic={onUseTopic} />);

    fireEvent.change(screen.getByLabelText('选题'), { target: { value: '异质图节点分类的鲁棒性' } });
    fireEvent.click(screen.getByRole('button', { name: '开始查新' }));

    expect(await screen.findByText('部分源不可达')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '以此选题立项' }));
    await waitFor(() => expect(onUseTopic).toHaveBeenCalledWith('异质图节点分类的鲁棒性'));
  });
});
