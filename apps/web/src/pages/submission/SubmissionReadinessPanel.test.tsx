import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { downloadBase64 } from '../../components/ui';
import type { SubmissionPackage, SubmissionReadiness } from '../../types';
import { SubmissionReadinessPanel } from './SubmissionReadinessPanel';

vi.mock('../../api/client', () => ({
  api: { submission: { readiness: vi.fn(), package: vi.fn() } },
}));

vi.mock('../../components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/ui')>();
  return { ...actual, downloadBase64: vi.fn() };
});

const readiness = vi.mocked(api.submission.readiness);
const packageApi = vi.mocked(api.submission.package);
const saveBase64 = vi.mocked(downloadBase64);
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

function packageResult(over: Partial<SubmissionPackage> = {}): SubmissionPackage {
  return {
    projectId: 'p1',
    documentId: 'doc-1',
    title: '异质图鲁棒性论文',
    generatedAt: '2026-11-20T08:00:00.000Z',
    filename: '异质图鲁棒性论文-投稿包.zip',
    base64: 'UEsDBA==',
    size: 1024,
    files: [
      { name: 'manuscript.docx', bytes: 512 },
      { name: 'references.bib', bytes: 200 },
      { name: 'submission-checklist.md', bytes: 180 },
      { name: 'manifest.json', bytes: 132 },
    ],
    ready: true,
    score: 92,
    failCount: 0,
    warnCount: 1,
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
  beforeEach(() => {
    readiness.mockReset();
    packageApi.mockReset();
    saveBase64.mockReset();
  });

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

  it('一键下载投稿包：调用真实 API，触发 ZIP 下载并展示包内文件', async () => {
    readiness.mockResolvedValue(result());
    packageApi.mockResolvedValue(packageResult());
    renderPanel();

    fireEvent.change(screen.getByLabelText('投稿文档'), { target: { value: 'doc-1' } });
    await screen.findByText('可投稿');
    fireEvent.click(screen.getByText('下载投稿包'));

    await waitFor(() => expect(packageApi).toHaveBeenCalledWith('p1', 'doc-1'));
    expect(saveBase64).toHaveBeenCalledWith('异质图鲁棒性论文-投稿包.zip', 'UEsDBA==', 'application/zip');
    const success = await screen.findByText(/已生成 异质图鲁棒性论文-投稿包.zip/);
    expect(success.textContent).toContain('manuscript.docx');
    expect(success.textContent).toContain('references.bib');
    expect(success.textContent).toContain('submission-checklist.md');
    expect(success.textContent).toContain('manifest.json');
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
