import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { SubmissionReadiness } from '../../types';
import { SubmissionReadinessPanel } from './SubmissionReadinessPanel';

vi.mock('../../api/client', () => ({
  api: { submission: { readiness: vi.fn() } },
}));

const readiness = vi.mocked(api.submission.readiness);
const docs = [{ id: 'doc-1', title: '异质图鲁棒性论文' }];

function result(over: Partial<SubmissionReadiness> = {}): SubmissionReadiness {
  return {
    projectId: 'p1',
    documentId: 'doc-1',
    title: '异质图鲁棒性论文',
    documentStatus: 'draft',
    updatedAt: 1,
    ready: true,
    score: 92,
    failCount: 0,
    warnCount: 1,
    standard: {
      key: 'standard',
      label: 'SCI 通用期刊',
      passScore: 80,
      minChars: 4500,
      minSections: 5,
      minUniqueCitations: 15,
    },
    items: [
      { key: 'title', label: '稿件标题', status: 'pass', detail: '标题：异质图鲁棒性论文' },
      { key: 'length', label: '正文篇幅', status: 'pass', detail: '正文 6200 字，达到 4500 字线。' },
      { key: 'citations', label: '正文引用闭环', status: 'pass', detail: '正文唯一引用 20 个。' },
      { key: 'references', label: '项目文献库', status: 'pass', detail: '文献库 24 条。' },
      { key: 'abstract', label: '摘要块', status: 'warn', detail: '未检测到摘要块。' },
    ],
    stats: {
      chars: 6200,
      sections: 7,
      citations: 20,
      uniqueCitations: 20,
      referenceEntries: 20,
      libraryReferences: 24,
      citationLinks: 20,
    },
    checkedAt: 1,
    ...over,
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SubmissionReadinessPanel projectId="p1" docs={docs} />
    </QueryClientProvider>,
  );
}

describe('SubmissionReadinessPanel', () => {
  beforeEach(() => readiness.mockReset());

  it('选中文档后展示可投稿与逐项状态', async () => {
    readiness.mockResolvedValue(result());
    renderPanel();

    fireEvent.change(screen.getByLabelText('投稿文档'), { target: { value: 'doc-1' } });

    expect(await screen.findByText('可投稿')).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.getByText(/SCI 通用期刊/)).toBeTruthy();
    expect(screen.getByText('未检测到摘要块。')).toBeTruthy();
    expect(readiness).toHaveBeenCalledWith('p1', 'doc-1');
  });

  it('阻塞项用红色状态明确展示，不把提醒伪装成通过', async () => {
    readiness.mockResolvedValue(
      result({
        ready: false,
        score: 48,
        failCount: 2,
        warnCount: 1,
        items: [
          { key: 'length', label: '正文篇幅', status: 'fail', detail: '正文 120 字，低于 500 字硬伤线。' },
          { key: 'references', label: '项目文献库', status: 'fail', detail: '文献库为空。' },
          { key: 'abstract', label: '摘要块', status: 'warn', detail: '未检测到摘要块。' },
        ],
      }),
    );
    renderPanel();

    fireEvent.change(screen.getByLabelText('投稿文档'), { target: { value: 'doc-1' } });

    expect(await screen.findByText('有阻塞项')).toBeTruthy();
    expect(screen.getByText('48%')).toBeTruthy();
    expect(screen.getByText('2 阻塞 · 1 提醒')).toBeTruthy();
    expect(screen.getByText('正文 120 字，低于 500 字硬伤线。')).toBeTruthy();
    expect(screen.getAllByText('阻塞').length).toBeGreaterThan(0);
  });
});
