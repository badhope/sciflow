import { zipSync } from 'fflate';
import { buildBibtex, type BibtexReferenceRow } from '../common/bibtex-export';
import { buildManuscriptDocx, type ManuscriptOutline, type ManuscriptReference } from '../documents/manuscript-docx';
import type { SubmissionReadinessResult } from './submission-readiness';

export interface SubmissionPackageFile {
  name: string;
  bytes: number;
}

export interface SubmissionPackageManifest {
  schemaVersion: 'sciflow-submission-package/1';
  generatedAt: string;
  projectId: string;
  documentId: string;
  title: string;
  standard: SubmissionReadinessResult['standard'];
  readiness: {
    ready: boolean;
    score: number;
    failCount: number;
    warnCount: number;
  };
  stats: SubmissionReadinessResult['stats'];
  files: SubmissionPackageFile[];
}

export interface SubmissionPackageInput {
  projectId: string;
  documentId: string;
  title: string;
  outline: ManuscriptOutline;
  content: string;
  projectRefs: BibtexReferenceRow[];
  citationRefs: ManuscriptReference[];
  readiness: SubmissionReadinessResult;
  generatedAt?: Date;
}

export interface SubmissionPackageResult {
  filename: string;
  base64: string;
  size: number;
  files: SubmissionPackageFile[];
}

const STATUS_LABEL = { pass: '通过', warn: '提醒', fail: '阻塞' } as const;

function safeCell(text: string): string {
  return String(text || '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function buildSubmissionChecklist(input: SubmissionPackageInput, generatedAt: Date): string {
  const r = input.readiness;
  const lines = [
    '# 投稿前检查清单',
    '',
    `- 项目：${input.projectId}`,
    `- 文档：${input.title || '未命名论文'}（${input.documentId}）`,
    `- 目标标准：${r.standard.label}（客观质量门 ≥ ${r.standard.passScore}）`,
    `- 就绪状态：${r.ready ? '可投稿' : '有阻塞项'}`,
    `- 就绪分：${r.score}%`,
    `- 阻塞 / 提醒：${r.failCount} / ${r.warnCount}`,
    `- 生成时间：${generatedAt.toISOString()}`,
    `- 统计：正文 ${r.stats.chars} 字 · 章节 ${r.stats.sections} · 唯一引用 ${r.stats.uniqueCitations} · 文献库 ${r.stats.libraryReferences} 条`,
    '',
    '## 检查项',
    '',
    '| 状态 | 检查项 | 说明 |',
    '| --- | --- | --- |',
    ...r.items.map((it) => `| ${STATUS_LABEL[it.status]} | ${safeCell(it.label)} | ${safeCell(it.detail)} |`),
    '',
    '## 包内文件',
    '',
    '- `manuscript.docx`：标题、大纲、正文与按 citation 顺序排列的参考文献。',
    '- `references.bib`：项目文献库 BibTeX，可直接导入 Zotero / EndNote / LaTeX。',
    '- `submission-checklist.md`：本清单，含阻塞项与提醒。',
    '- `manifest.json`：机器可读的检查结果与文件清单。',
    '',
    '## 说明',
    '',
    '- 这是投稿前的确定性自检，不替代期刊编辑初审、查重或同行评审。',
    '- 「提醒」不阻塞提交；「阻塞」建议先补齐再投。',
    '- 若本包来自阻塞态，清单会保留阻塞项，不会把未通过伪装成可投稿。',
    '',
  ];
  return lines.join('\n');
}

/**
 * 生成投稿包（确定性、不调模型）。
 *
 * 复用既有 DOCX / BibTeX 导出与 readiness 结果；ZIP 只做编排，不改变任何原始内容。
 */
export async function buildSubmissionPackage(input: SubmissionPackageInput): Promise<SubmissionPackageResult> {
  const generatedAt = input.generatedAt ?? new Date();
  const manuscript = await buildManuscriptDocx({
    title: input.title,
    outline: input.outline,
    content: input.content,
    refs: input.citationRefs,
  });
  const bibtex = buildBibtex(input.projectRefs);
  const checklist = buildSubmissionChecklist(input, generatedAt);

  const files: SubmissionPackageFile[] = [
    { name: 'manuscript.docx', bytes: manuscript.buffer.byteLength },
    { name: 'references.bib', bytes: Buffer.byteLength(bibtex) },
    { name: 'submission-checklist.md', bytes: Buffer.byteLength(checklist) },
    { name: 'manifest.json', bytes: 0 },
  ];
  const manifest: SubmissionPackageManifest = {
    schemaVersion: 'sciflow-submission-package/1',
    generatedAt: generatedAt.toISOString(),
    projectId: input.projectId,
    documentId: input.documentId,
    title: input.title,
    standard: input.readiness.standard,
    readiness: {
      ready: input.readiness.ready,
      score: input.readiness.score,
      failCount: input.readiness.failCount,
      warnCount: input.readiness.warnCount,
    },
    stats: input.readiness.stats,
    files,
  };
  // manifest 自身也列在 files 里：数字位数会反过来改变文件大小，迭代到稳定为止。
  for (let i = 0; i < 3; i++) {
    files[3].bytes = Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`);
  }
  manifest.files = files;
  const finalManifest = `${JSON.stringify(manifest, null, 2)}\n`;

  const zip = zipSync(
    {
      'manuscript.docx': new Uint8Array(manuscript.buffer),
      'references.bib': new Uint8Array(Buffer.from(bibtex, 'utf8')),
      'submission-checklist.md': new Uint8Array(Buffer.from(checklist, 'utf8')),
      'manifest.json': new Uint8Array(Buffer.from(finalManifest, 'utf8')),
    },
    { level: 6 },
  );
  const baseName = (input.title || '未命名论文').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名论文';
  return {
    filename: `${baseName}-投稿包.zip`,
    base64: Buffer.from(zip).toString('base64'),
    size: zip.byteLength,
    files,
  };
}
