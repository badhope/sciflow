import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildSubmissionPackage } from './submission-package';
import type { SubmissionReadinessResult } from './submission-readiness';

const readiness: SubmissionReadinessResult = {
  ready: false,
  score: 40,
  failCount: 2,
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
    { key: 'title', label: '稿件标题', status: 'pass', detail: '标题：测试投稿包' },
    { key: 'length', label: '正文篇幅', status: 'fail', detail: '正文 81 字，低于 500 字硬伤线。' },
    { key: 'citations', label: '正文引用闭环', status: 'fail', detail: 'citation 表 0 条。' },
    { key: 'keywords', label: '关键词块', status: 'warn', detail: '未检测到关键词块。' },
  ],
  stats: {
    chars: 81,
    sections: 4,
    citations: 1,
    uniqueCitations: 1,
    referenceEntries: 0,
    libraryReferences: 2,
    citationLinks: 0,
  },
};

const input = {
  projectId: 'p1',
  documentId: 'd1',
  title: '测试投稿包',
  outline: { title: '测试投稿包', sections: [{ title: '引言', subsections: ['背景'] }] },
  content: '## 引言\n这是一段用于 DOCX 的测试正文。',
  projectRefs: [
    { id: 'r1', title: 'Graph Robustness', authors: '["Alice","Bob"]', year: 2024, venue: 'Journal A', doi: '10.1/a' },
    { id: 'r2', title: 'Node Classification', authors: '["Carol"]', year: 2023, venue: 'Journal B', doi: '10.1/b' },
  ],
  citationRefs: [{ title: 'Graph Robustness', authors: '["Alice","Bob"]', year: 2024, venue: 'Journal A', doi: '10.1/a' }],
  readiness,
  generatedAt: new Date('2026-11-20T00:00:00.000Z'),
};

// 1x1 PNG，用来验证图表附件会被解码、嵌入 DOCX 并打进 ZIP。
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('buildSubmissionPackage', () => {
  it('生成投稿包 ZIP（含 Cover Letter / 模板 / 图表），清单保留阻塞项，manifest 与 readiness 一致', async () => {
    const pkg = await buildSubmissionPackage({
      ...input,
      journal: 'Journal of Graph Research',
      template: 'ieee',
      figures: [{ name: 'figures/figure-01.png', caption: '消融实验结果', bytes: PNG_1PX.length, data: PNG_1PX }],
    });
    expect(pkg.filename).toBe('测试投稿包-投稿包.zip');
    expect(pkg.size).toBeGreaterThan(0);
    expect(pkg.template.key).toBe('ieee');
    expect(pkg.files.map((f) => f.name)).toEqual([
      'manuscript.docx',
      'cover-letter.md',
      'references.bib',
      'submission-checklist.md',
      'figures/captions.md',
      'figures/figure-01.png',
      'manifest.json',
    ]);

    const files = unzipSync(new Uint8Array(Buffer.from(pkg.base64, 'base64')));
    expect(Object.keys(files).sort()).toEqual([
      'cover-letter.md',
      'figures/captions.md',
      'figures/figure-01.png',
      'manifest.json',
      'manuscript.docx',
      'references.bib',
      'submission-checklist.md',
    ]);

    const manifestRaw = strFromU8(files['manifest.json']);
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.schemaVersion).toBe('sciflow-submission-package/2');
    expect(manifest.template).toMatchObject({ key: 'ieee', label: 'IEEE 双栏风格' });
    expect(manifest.journal).toBe('Journal of Graph Research');
    expect(manifest.files.find((f: { name: string }) => f.name === 'manifest.json').bytes).toBe(Buffer.byteLength(manifestRaw));
    expect(manifest.readiness).toMatchObject({ ready: false, score: 40, failCount: 2, warnCount: 1 });
    expect(manifest.files).toHaveLength(7);
    expect(manifest.files.every((f: { bytes: number }) => f.bytes > 0)).toBe(true);

    const cover = strFromU8(files['cover-letter.md']);
    expect(cover).toContain('Journal of Graph Research');
    expect(cover).toContain('测试投稿包');
    expect(cover).toContain('［请填写姓名、单位、邮箱］');
    expect(cover).not.toContain('虚构作者');

    const checklist = strFromU8(files['submission-checklist.md']);
    expect(checklist).toContain('有阻塞项');
    expect(checklist).toContain('排版模板：IEEE 双栏风格');
    expect(checklist).toContain('图表 1 张');
    expect(checklist).toContain('| 阻塞 | 正文篇幅 |');
    expect(checklist).toContain('| 提醒 | 关键词块 |');

    const bibtex = strFromU8(files['references.bib']);
    expect((bibtex.match(/^@/gm) || []).length).toBe(2);
    expect(bibtex).toContain('Graph Robustness');
    expect(bibtex).not.toContain('{Graph}');

    // DOCX 是合法 ZIP：document.xml 里应包含稿件标题与正文
    const docxFiles = unzipSync(files['manuscript.docx']);
    const documentXml = strFromU8(docxFiles['word/document.xml']);
    expect(documentXml).toContain('测试投稿包');
    expect(documentXml).toContain('这是一段用于 DOCX 的测试正文。');
    // 图表附件同时进 DOCX（drawing）与 ZIP（figures/）
    expect(documentXml).toContain('<w:drawing>');
    expect(strFromU8(files['figures/captions.md'])).toContain('消融实验结果');
  });

  it('可投稿态清单明确写可投稿；文献库为空时仍生成合法 BibTeX 文件', async () => {
    const pkg = await buildSubmissionPackage({
      ...input,
      projectRefs: [],
      citationRefs: [],
      readiness: { ...readiness, ready: true, score: 100, failCount: 0, warnCount: 0 },
    });
    const files = unzipSync(new Uint8Array(Buffer.from(pkg.base64, 'base64')));
    expect(strFromU8(files['submission-checklist.md'])).toContain('就绪状态：可投稿');
    expect(strFromU8(files['references.bib'])).toContain('项目文献库为空');
    expect(pkg.files.map((f) => f.name)).toEqual([
      'manuscript.docx', 'cover-letter.md', 'references.bib', 'submission-checklist.md', 'manifest.json',
    ]);
  });
});
