import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * 质量页「客观检查器」契约（v1.8）。
 *
 * 背景：本页此前只有 LLM 7 维评分，而流水线质量门用的是确定性客观分。
 * 两者数字不同（同一稿 LLM 实测漂移 27–59）→ 用户看到「页面 62 分却过闸」的认知冲突。
 * 现在客观分必须：
 *   1) 选中文档后自动出现（无需点按钮，零模型成本）
 *   2) 显示六维分与指纹（可复现）
 *   3) 硬伤存在时明确标注「总分封顶 40」
 */

const objectiveAudit = vi.fn();
const projectOverview = vi.fn();
vi.mock('../api/client', () => ({
  api: {
    documents: {
      list: vi.fn(async () => [
        { id: 'd-old', title: '旧稿', content: '旧正文', projectId: 'p-1' },
        { id: 'd-1', title: '测试稿', content: '正文', projectId: 'p-1' },
      ]),
      objectiveAudit: (...args: unknown[]) => objectiveAudit(...args),
      citationAudit: vi.fn(),
    },
    quality: {
      history: vi.fn(async () => []),
      review: vi.fn(),
      exportComments: vi.fn(),
      projectOverview: (projectId: string) => projectOverview(projectId),
    },
  },
  errMsg: (e: unknown) => String(e),
}));

const project = { id: 'p-1', name: '项目', description: '', createdAt: 0, updatedAt: 0 } as never;

const report = {
  totalScore: 78,
  dimensions: [
    { key: 'structure', label: '结构完整性', score: 18, weight: 1, evidence: '' },
    { key: 'length', label: '篇幅达标', score: 16, weight: 1, evidence: '' },
    { key: 'citation', label: '引用闭环', score: 12, weight: 1, evidence: '' },
    { key: 'readability', label: '可读性', score: 14, weight: 1, evidence: '' },
    { key: 'rigor', label: '修辞严谨', score: 10, weight: 1, evidence: '' },
    { key: 'integrity', label: '学术诚信', score: 8, weight: 1, evidence: '' },
  ],
  hardFails: ['长篇正文（6120 字符）没有任何 [n] 引用锚点'],
  stats: {
    chars: 6120, cjkChars: 5900, englishWords: 60, sections: 6, paragraphs: 22, sentences: 90,
    citations: 0, referenceEntries: 0, uniqueCitations: 0, avgSentenceChars: 62,
    duplicateParagraphs: 0, placeholderHits: 0,
  },
  fingerprint: 'q1a2b3c4',
};

async function renderPage() {
  const { QualityPage } = await import('./QualityPage');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <QualityPage project={project} />
    </QueryClientProvider>,
  );
}

describe('质量页：客观检查器卡片', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    objectiveAudit.mockReset();
    objectiveAudit.mockResolvedValue({ documentId: 'd-1', title: '测试稿', report, llmHistory: [] });
    projectOverview.mockReset();
    projectOverview.mockResolvedValue({
      projectId: 'p-1', total: 2, passed: 0, failed: 2, unscored: 0,
      // 故意逆序返回，验证前端兜底排序（不依赖接口顺序）
      items: [
        { documentId: 'd-1', title: '测试稿', status: 'draft', updatedAt: 2, chars: 6120, objectiveScore: 78, fingerprint: 'q1a2b3c4', hardFailCount: 1, hardFails: ['长篇正文（6120 字符）没有任何 [n] 引用锚点'], llmScore: 62, llmScoredAt: 1, passed: false },
        { documentId: 'd-old', title: '旧稿', status: 'draft', updatedAt: 1, chars: 340, objectiveScore: 0, fingerprint: 'q9z8y7x6', hardFailCount: 2, hardFails: ['正文过短'], llmScore: null, llmScoredAt: null, passed: false },
      ],
    });
  });

  it('选中文档后自动运行客观检查（不发 LLM 请求）', { timeout: 20000 }, async () => {
    await renderPage();
    await waitFor(() => expect(objectiveAudit).toHaveBeenCalledWith('d-1'));
  });

  it('展示总分、六维分数与指纹', { timeout: 20000 }, async () => {
    const r = await renderPage();
    await waitFor(() => expect(objectiveAudit).toHaveBeenCalled());
    // 一律用容器 textContent 断言：Badge 内部是多文本节点，screen.getByText 会碎匹配失败
    await waitFor(() => {
      expect(r.container.textContent).toContain('客观检查器（确定性）');
      expect(r.container.textContent).toContain('78/100');
    });
    expect(r.container.textContent).toContain('q1a2b3c4');
    for (const d of report.dimensions) {
      expect(r.container.textContent).toContain(d.label);
    }
  });

  it('有硬伤时明确标注封顶与具体原因', { timeout: 20000 }, async () => {
    const r = await renderPage();
    await waitFor(() => {
      expect(r.container.textContent).toContain('硬伤 1 项');
      expect(r.container.textContent).toContain('总分封顶 40');
      expect(r.container.textContent).toContain('没有任何 [n] 引用锚点');
    });
  });

  it('进入页面就给出全部文档最新分总览（最差优先）', { timeout: 20000 }, async () => {
    const r = await renderPage();
    await waitFor(() => expect(r.container.textContent).toContain('全部文档最新分'));
    expect(r.container.textContent).toContain('达标 0');
    expect(r.container.textContent).toContain('未达标 2');
    // 最差优先：0 分旧稿必须排在 78 分测试稿之前。
    // 必须只看总览卡（下拉框里也含「测试稿」，全容器比对会误判）。
    const card = r.container.querySelector('#quality-overview');
    expect(card).toBeTruthy();
    const txt = card!.textContent!;
    expect(txt).toContain('旧稿');
    expect(txt).toContain('测试稿');
    expect(txt.indexOf('旧稿')).toBeLessThan(txt.indexOf('测试稿'));
  });

  it('默认选中最新一篇（docs[0] 是最旧的，历史 bug）', { timeout: 20000 }, async () => {
    await renderPage();
    // list 返回 [旧稿, 测试稿]（updatedAt 升序），默认应选后者
    await waitFor(() => expect(objectiveAudit).toHaveBeenCalledWith('d-1'));
    expect(objectiveAudit).not.toHaveBeenCalledWith('d-old');
  });

  it('点击总览某一行会切换当前文档', { timeout: 20000 }, async () => {
    const r = await renderPage();
    await waitFor(() => expect(r.container.textContent).toContain('旧稿'));
    const row = [...r.container.querySelectorAll('button')].find((b) => b.textContent?.includes('旧稿'));
    expect(row).toBeTruthy();
    row!.click();
    await waitFor(() => expect(objectiveAudit).toHaveBeenCalledWith('d-old'));
  });
  it('说明该分就是流水线质量门用的分（消除双分数认知冲突）', { timeout: 20000 }, async () => {
    const r = await renderPage();
    await waitFor(() => expect(r.container.textContent).toContain('流水线质量门用的就是这个分'));
  });
});
