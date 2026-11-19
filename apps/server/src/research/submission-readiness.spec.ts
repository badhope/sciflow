import { describe, expect, it } from 'vitest';
import { assessSubmissionReadiness } from './submission-readiness';

function paper(opts: { chars?: number; refs?: number; citations?: number; abstract?: boolean; keywords?: boolean } = {}) {
  const chars = opts.chars ?? 6200;
  const citations = opts.citations ?? 20;
  const sections = ['引言', '相关工作', '方法', '实验设置', '结果', '讨论', '结论'];
  const head = [
    ...(opts.abstract === false ? [] : ['## 摘要', '本文研究异质图节点分类的鲁棒性问题，提出一种可复现的残差聚合方法，并在多个基准上比较。']),
    ...(opts.keywords === false ? [] : ['关键词：异质图；节点分类；鲁棒性；图神经网络']),
  ];
  const body: string[] = [];
  let index = 1;
  for (const s of sections) {
    body.push(`## ${s}`);
    const paragraphs = Math.ceil((chars - head.join('').length) / sections.length / 90);
    for (let i = 0; i < paragraphs; i++) {
      const n = index++;
      body.push(
        `第 ${n} 段讨论异质图上的残差聚合与邻居采样。该段使用不同句式描述实验条件、变量控制与误差来源，避免重复段落影响可读性判定。` +
          (n <= citations ? ` 相关结论见文献 [${n}]。` : ''),
      );
    }
  }
  return [...head, ...body].join('\n');
}

describe('assessSubmissionReadiness', () => {
  it('逐项核对：完整稿可投稿，分数与标准来自同一套客观口径', () => {
    const res = assessSubmissionReadiness({
      title: '异质图节点分类的鲁棒残差聚合',
      content: paper(),
      libraryReferences: 24,
      citationLinks: 20,
      standard: 'standard',
    });
    expect(res.items.map((i) => i.key)).toEqual([
      'title', 'length', 'structure', 'citations', 'references', 'abstract', 'keywords', 'quality',
    ]);
    expect(res.items.find((i) => i.key === 'references')?.status).toBe('pass');
    expect(res.items.find((i) => i.key === 'abstract')?.status).toBe('pass');
    expect(res.items.find((i) => i.key === 'keywords')?.status).toBe('pass');
    expect(res.standard.key).toBe('standard');
    expect(res.score).toBeGreaterThan(0);
    expect(res.failCount).toBe(0);
    expect(res.ready).toBe(true);
  });

  it('空稿直接阻塞：篇幅、引用与质量门都判 fail', () => {
    const res = assessSubmissionReadiness({
      title: '未命名论文',
      content: '',
      libraryReferences: 0,
      citationLinks: 0,
    });
    expect(res.ready).toBe(false);
    expect(res.items.find((i) => i.key === 'title')?.status).toBe('fail');
    expect(res.items.find((i) => i.key === 'length')?.status).toBe('fail');
    expect(res.items.find((i) => i.key === 'references')?.status).toBe('fail');
    expect(res.items.find((i) => i.key === 'quality')?.status).toBe('fail');
  });

  it('文献库为空即使正文有锚点也不能放行', () => {
    const res = assessSubmissionReadiness({
      title: '异质图节点分类的鲁棒残差聚合',
      content: paper(),
      libraryReferences: 0,
      citationLinks: 20,
    });
    expect(res.items.find((i) => i.key === 'references')).toMatchObject({ status: 'fail' });
    expect(res.ready).toBe(false);
  });

  it('摘要/关键词缺失只提醒、不阻塞', () => {
    const res = assessSubmissionReadiness({
      title: '异质图节点分类的鲁棒残差聚合',
      content: paper({ abstract: false, keywords: false }),
      libraryReferences: 24,
      citationLinks: 20,
    });
    expect(res.items.find((i) => i.key === 'abstract')?.status).toBe('warn');
    expect(res.items.find((i) => i.key === 'keywords')?.status).toBe('warn');
  });

  it('引用强度低于标准时提醒，不直接判死', () => {
    const res = assessSubmissionReadiness({
      title: '异质图节点分类的鲁棒残差聚合',
      content: paper({ citations: 3 }),
      libraryReferences: 10,
      citationLinks: 3,
    });
    expect(res.items.find((i) => i.key === 'citations')?.status).toBe('warn');
    expect(res.items.find((i) => i.key === 'references')?.status).toBe('warn');
  });
});
