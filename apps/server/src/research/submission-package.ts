import { zipSync } from 'fflate';
import { buildBibtex, type BibtexReferenceRow } from '../common/bibtex-export';
import { buildManuscriptDocx, type ManuscriptFigure, type ManuscriptOutline, type ManuscriptReference } from '../documents/manuscript-docx';
import { parseSubmissionTemplate, type SubmissionTemplateStyle } from './submission-templates';
import type { SubmissionReadinessResult } from './submission-readiness';

export interface SubmissionPackageFile {
  name: string;
  bytes: number;
}

export interface SubmissionPackageFigure {
  name: string;
  caption: string;
  bytes: number;
  data: Buffer;
}

export interface SubmissionPackageManifest {
  schemaVersion: 'sciflow-submission-package/2';
  generatedAt: string;
  projectId: string;
  documentId: string;
  title: string;
  journal: string;
  template: { key: string; label: string; note: string };
  standard: SubmissionReadinessResult['standard'];
  readiness: {
    ready: boolean;
    score: number;
    failCount: number;
    warnCount: number;
  };
  stats: SubmissionReadinessResult['stats'];
  figures: { name: string; caption: string; bytes: number }[];
  files: SubmissionPackageFile[];
}

export interface SubmissionPackageInput {
  projectId: string;
  documentId: string;
  title: string;
  projectName?: string;
  outline: ManuscriptOutline;
  content: string;
  projectRefs: BibtexReferenceRow[];
  citationRefs: ManuscriptReference[];
  readiness: SubmissionReadinessResult;
  journal?: string;
  template?: string;
  figures?: SubmissionPackageFigure[];
  generatedAt?: Date;
}

export interface SubmissionPackageResult {
  filename: string;
  base64: string;
  size: number;
  files: SubmissionPackageFile[];
  template: SubmissionTemplateStyle;
  journal: string;
  figures: { name: string; caption: string; bytes: number }[];
}

const STATUS_LABEL = { pass: '通过', warn: '提醒', fail: '阻塞' } as const;

function safeCell(text: string): string {
  return String(text || '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function plainSummary(content: string, max = 320): string {
  const first = String(content || '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^#{1,6}\s+/gm, '').replace(/[*_`#>]/g, '').replace(/^(摘要|Abstract|关键词|Keywords)\s*[:：]?\s*/i, '').replace(/\s+/g, ' ').trim())
    .filter((p) => p && !/^[-|]/.test(p))
    .join(' ');
  if (!first) return '（正文尚未填写摘要，请在投稿前补充研究背景、方法、主要结果与结论。）';
  return first.slice(0, max) + (first.length > max ? '…' : '');
}

export function buildCoverLetter(input: SubmissionPackageInput, generatedAt: Date, template: SubmissionTemplateStyle): string {
  const journal = (input.journal || '').trim() || '贵刊';
  const summary = plainSummary(input.content);
  return [
    '# Cover Letter',
    '',
    `Dear Editor of ${journal},`,
    '',
    `We are pleased to submit our manuscript entitled “${input.title || '未命名论文'}” for consideration as an Original Research Article.`,
    '',
    '## 研究简介',
    '',
    summary,
    '',
    '## 为什么适合贵刊',
    '',
    `- 本文围绕「${input.title || '未命名论文'}」展开，核心贡献与贵刊读者关注的研究方向一致。`,
    `- 稿件已完成 ${input.readiness.stats.sections} 个章节、${input.readiness.stats.chars} 字正文，引用 ${input.readiness.stats.uniqueCitations} 篇文献，并已通过 SciFlow 投稿就绪自检（${input.readiness.ready ? '可投稿' : '仍有阻塞项，随包清单标注'}）。`,
    '- 全部数据与代码可复现，图表与参考文献随稿提交。',
    '',
    '## 声明',
    '',
    '- 本稿件未在其他期刊发表，也未同时投递其他期刊。',
    '- 所有作者均已阅读并同意投稿，作者贡献与利益冲突声明将在投稿系统中补充。',
    '- 若需补充材料或推荐审稿人，我们可随时提供。',
    '',
    '此致',
    '',
    '通讯作者：［请填写姓名、单位、邮箱］',
    `生成时间：${generatedAt.toISOString()} · 模板：${template.label}`,
    '',
  ].join('\n');
}

export function buildSubmissionChecklist(input: SubmissionPackageInput, generatedAt: Date, template: SubmissionTemplateStyle): string {
  const r = input.readiness;
  const lines = [
    '# 投稿前检查清单',
    '',
    `- 项目：${input.projectName || input.projectId}`,
    `- 文档：${input.title || '未命名论文'}（${input.documentId}）`,
    `- 目标标准：${r.standard.label}（客观质量门 ≥ ${r.standard.passScore}）`,
    `- 排版模板：${template.label}（${template.note}）`,
    `- 目标期刊：${input.journal || '未填写'}`,
    `- 就绪状态：${r.ready ? '可投稿' : '有阻塞项'}`,
    `- 就绪分：${r.score}%`,
    `- 阻塞 / 提醒：${r.failCount} / ${r.warnCount}`,
    `- 生成时间：${generatedAt.toISOString()}`,
    `- 统计：正文 ${r.stats.chars} 字 · 章节 ${r.stats.sections} · 唯一引用 ${r.stats.uniqueCitations} · 文献库 ${r.stats.libraryReferences} 条 · 图表 ${input.figures?.length || 0} 张`,
    '',
    '## 检查项',
    '',
    '| 状态 | 检查项 | 说明 |',
    '| --- | --- | --- |',
    ...r.items.map((it) => `| ${STATUS_LABEL[it.status]} | ${safeCell(it.label)} | ${safeCell(it.detail)} |`),
    '',
    '## 包内文件',
    '',
    '- `manuscript.docx`：标题、大纲、正文、图表与按 citation 顺序排列的参考文献。',
    '- `cover-letter.md`：按目标期刊生成的投稿信草稿（通讯作者信息需人工补填）。',
    '- `references.bib`：项目文献库 BibTeX，可直接导入 Zotero / EndNote / LaTeX。',
    '- `submission-checklist.md`：本清单，含阻塞项、提醒与模板信息。',
    '- `figures/`：实验产出的 PNG 图表与 captions.md（没有图表时不生成）。',
    '- `manifest.json`：机器可读的检查结果、模板与文件清单。',
    '',
    '## 说明',
    '',
    '- 这是投稿前的确定性自检，不替代期刊编辑初审、查重或同行评审。',
    '- 「提醒」不阻塞提交；「阻塞」建议先补齐再投。',
    '- Cover Letter 是模板草稿，不包含虚构的作者信息；请补填通讯作者与单位。',
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
  const template = parseSubmissionTemplate(input.template);
  const journal = (input.journal || '').trim();
  const figures = input.figures ?? [];
  const manuscriptFigures: ManuscriptFigure[] = figures.map((f) => ({ data: f.data, caption: f.caption, name: f.name }));
  const manuscript = await buildManuscriptDocx({
    title: input.title,
    outline: input.outline,
    content: input.content,
    refs: input.citationRefs,
    template,
    figures: manuscriptFigures,
  });
  const bibtex = buildBibtex(input.projectRefs);
  const coverLetter = buildCoverLetter(input, generatedAt, template);
  const checklist = buildSubmissionChecklist(input, generatedAt, template);
  const figureCaptions = figures.length
    ? ['# 图表说明', '', ...figures.map((f, i) => `${i + 1}. \`${f.name}\`：${f.caption || '（未填写说明）'}`)].join('\n') + '\n'
    : '';

  const files: SubmissionPackageFile[] = [
    { name: 'manuscript.docx', bytes: manuscript.buffer.byteLength },
    { name: 'cover-letter.md', bytes: Buffer.byteLength(coverLetter) },
    { name: 'references.bib', bytes: Buffer.byteLength(bibtex) },
    { name: 'submission-checklist.md', bytes: Buffer.byteLength(checklist) },
    ...(figures.length ? [{ name: 'figures/captions.md', bytes: Buffer.byteLength(figureCaptions) }] : []),
    ...figures.map((f) => ({ name: f.name, bytes: f.bytes })),
    { name: 'manifest.json', bytes: 0 },
  ];
  const manifestIndex = files.length - 1;
  const manifest: SubmissionPackageManifest = {
    schemaVersion: 'sciflow-submission-package/2',
    generatedAt: generatedAt.toISOString(),
    projectId: input.projectId,
    documentId: input.documentId,
    title: input.title,
    journal,
    template: { key: template.key, label: template.label, note: template.note },
    standard: input.readiness.standard,
    readiness: {
      ready: input.readiness.ready,
      score: input.readiness.score,
      failCount: input.readiness.failCount,
      warnCount: input.readiness.warnCount,
    },
    stats: input.readiness.stats,
    figures: figures.map((f) => ({ name: f.name, caption: f.caption, bytes: f.bytes })),
    files,
  };
  // manifest 自身也列在 files 里：数字位数会反过来改变文件大小，迭代到稳定为止。
  for (let i = 0; i < 4; i++) {
    files[manifestIndex].bytes = Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`);
  }
  manifest.files = files;
  const finalManifest = `${JSON.stringify(manifest, null, 2)}\n`;

  const zipEntries: Record<string, Uint8Array> = {
    'manuscript.docx': new Uint8Array(manuscript.buffer),
    'cover-letter.md': new Uint8Array(Buffer.from(coverLetter, 'utf8')),
    'references.bib': new Uint8Array(Buffer.from(bibtex, 'utf8')),
    'submission-checklist.md': new Uint8Array(Buffer.from(checklist, 'utf8')),
    'manifest.json': new Uint8Array(Buffer.from(finalManifest, 'utf8')),
  };
  for (const fig of figures) zipEntries[fig.name] = new Uint8Array(fig.data);
  if (figures.length) zipEntries['figures/captions.md'] = new Uint8Array(Buffer.from(figureCaptions, 'utf8'));

  const zip = zipSync(zipEntries, { level: 6 });
  const baseName = (input.title || '未命名论文').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名论文';
  return {
    filename: `${baseName}-投稿包.zip`,
    base64: Buffer.from(zip).toString('base64'),
    size: zip.byteLength,
    files,
    template,
    journal,
    figures: figures.map((f) => ({ name: f.name, caption: f.caption, bytes: f.bytes })),
  };
}
