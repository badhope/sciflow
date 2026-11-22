import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { downloadBase64 } from '../../components/ui';
import type { SubmissionPackage, SubmissionReadiness } from '../../types';
import { insertMissingSubmissionBlocks, SubmissionReadinessPanel } from './SubmissionReadinessPanel';

vi.mock('../../api/client', () => ({
  api: {
    submission: {
      readiness: vi.fn(),
      package: vi.fn(),
      templates: vi.fn(async () => [{ key: 'generic', label: '通用中文投稿', note: '' }, { key: 'ieee', label: 'IEEE 双栏风格', note: '' }]),
    },
    projects: {
      qualityStandard: vi.fn(async () => ({ key: 'standard', label: 'SCI 通用期刊', passScore: 80, minChars: 4500, minSections: 5, minUniqueCitations: 15, source: 'global' })),
      setQualityStandard: vi.fn(),
    },
    documents: {
      get: vi.fn(),
      abstract: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/ui')>();
  return { ...actual, downloadBase64: vi.fn() };
});

const readiness = vi.mocked(api.submission.readiness);
const packageApi = vi.mocked(api.submission.package);
const saveBase64 = vi.mocked(downloadBase64);
const docs = [{ id: 'doc-1', title: '异质图鲁棒性论文' }];function result(over: Partial<SubmissionReadiness> = {}): SubmissionReadiness {
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
    journal: '',
    template: { key: 'generic', label: '通用中文投稿', note: '' },
    figures: [],
    ...over,
  };
}

function Harness() {
  const [journal, setJournal] = useState('');
  return <SubmissionReadinessPanel projectId="p1" docs={docs} journal={journal} onJournalChange={setJournal} />;
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness />
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
    expect(screen.getAllByText(/SCI 通用期刊/).length).toBeGreaterThan(0);
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

    await waitFor(() => expect(packageApi).toHaveBeenCalledWith('p1', 'doc-1', { journal: '', template: 'generic' }));
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

  it('摘要/关键词缺失时可一键生成并只补缺失块', async () => {
    readiness.mockResolvedValue(
      result({
        items: [
          { key: 'abstract', label: '摘要块', status: 'warn', detail: '未检测到摘要块。' },
          { key: 'keywords', label: '关键词块', status: 'warn', detail: '未检测到关键词块。' },
        ],
      }),
    );
    vi.mocked(api.documents.get).mockResolvedValue({ id: 'doc-1', title: '异质图鲁棒性论文', content: '# 异质图鲁棒性论文\n\n正文第一段。' } as never);
    vi.mocked(api.documents.abstract).mockResolvedValue({ abstract: '这是摘要。', keywords: ['图神经网络', '鲁棒性'] });
    vi.mocked(api.documents.update).mockResolvedValue({} as never);

    renderPanel();
    fireEvent.change(screen.getByLabelText('投稿文档'), { target: { value: 'doc-1' } });
    expect(await screen.findByText('可补齐：摘要块、关键词块')).toBeTruthy();
    fireEvent.click(screen.getByText('生成并插入'));

    await waitFor(() => expect(api.documents.update).toHaveBeenCalled());
    const next = vi.mocked(api.documents.update).mock.calls[0][1].content as string;
    expect(next).toContain('# 异质图鲁棒性论文');
    expect(next).toContain('## 摘要');
    expect(next).toContain('这是摘要。');
    expect(next).toContain('## 关键词');
    expect(next).toContain('图神经网络；鲁棒性');
    expect(await screen.findByText('已插入摘要、关键词，可继续在写作页修改。')).toBeTruthy();
  });
});

describe('insertMissingSubmissionBlocks', () => {
  it('插在首个一级标题之后，并保留原有正文', () => {
    const next = insertMissingSubmissionBlocks('# 标题\n\n原正文', '摘要内容', ['关键词一', '关键词二'], true, true);
    expect(next).toBe('# 标题\n\n## 摘要\n\n摘要内容\n\n## 关键词\n\n关键词一；关键词二\n\n原正文');
  });

  it('只补缺失项，不覆盖已有摘要', () => {
    const next = insertMissingSubmissionBlocks('# 标题\n\n## 摘要\n\n旧摘要\n\n正文', '新摘要', ['词'], false, true);
    expect(next).not.toContain('新摘要');
    expect(next).toContain('## 关键词\n\n词');
  });
});
