/** 内置期刊排版模板：只控制 DOCX 字体/字号/行距，不伪造期刊官方模板。 */
export interface SubmissionTemplateStyle {
  key: SubmissionTemplateKey;
  label: string;
  font: string;
  titleSize: number; // half-points
  bodySize: number; // half-points
  lineSpacing: number; // twips, 240 = 单倍
  note: string;
}

export type SubmissionTemplateKey = 'generic' | 'ieee' | 'elsevier' | 'springer' | 'nature';

export const SUBMISSION_TEMPLATES: SubmissionTemplateStyle[] = [
  { key: 'generic', label: '通用中文投稿', font: '宋体', titleSize: 32, bodySize: 24, lineSpacing: 360, note: '中文论文常用：宋体小四、1.5 倍行距' },
  { key: 'ieee', label: 'IEEE 双栏风格', font: 'Times New Roman', titleSize: 28, bodySize: 20, lineSpacing: 240, note: '英文会议常用：Times 10pt、单倍行距（单栏导出）' },
  { key: 'elsevier', label: 'Elsevier 通用', font: 'Times New Roman', titleSize: 30, bodySize: 24, lineSpacing: 400, note: 'Elsevier 初稿常用：Times 12pt、双倍行距' },
  { key: 'springer', label: 'Springer 通用', font: 'Times New Roman', titleSize: 30, bodySize: 22, lineSpacing: 300, note: 'Springer 初稿常用：Times 11pt、1.25 倍行距' },
  { key: 'nature', label: 'Nature 风格', font: 'Arial', titleSize: 32, bodySize: 24, lineSpacing: 360, note: 'Nature 初稿常用：Arial 12pt、1.5 倍行距（单栏导出）' },
];

export const DEFAULT_SUBMISSION_TEMPLATE: SubmissionTemplateKey = 'generic';

export function parseSubmissionTemplate(value?: string | null): SubmissionTemplateStyle {
  const key = String(value || '').trim().toLowerCase();
  return SUBMISSION_TEMPLATES.find((t) => t.key === key) ?? SUBMISSION_TEMPLATES[0];
}
