/**
 * 段落级版本恢复（纯函数，无 IO）。
 *
 * 整篇快照无法回答「这节我改了什么」，因此把 Markdown 按标题切成 section，
 * 支持：逐节 diff（哪节变了）、单节回滚（只把某一节恢复到历史版本）、
 * 以及缺失/新增节的判定。渲染层按标题文本匹配——标题重命名视为「旧节消失 + 新节出现」，
 * 不做模糊匹配（宁可让用户看见名字变了，也不猜错节）。
 */

export interface DocSection {
  /** 标题文本（不含 # 前缀）；无标题前言为空字符串 */
  title: string;
  /** 标题层级；0 = 无标题前言 */
  level: number;
  /** 本节正文（不含标题行） */
  body: string;
  /** 全文中的起止行号（0 基，含标题行） */
  startLine: number;
  endLine: number;
}

export type SectionStatus = 'unchanged' | 'changed' | 'added' | 'removed';

export interface SectionDiffEntry {
  title: string;
  level: number;
  status: SectionStatus;
  changed: boolean;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

export function extractSections(markdown: string): DocSection[] {
  if (!markdown || !markdown.trim()) return [];
  const lines = markdown.split('\n');
  const sections: DocSection[] = [];
  let current: DocSection | null = null;

  /** lastLine 为本节最后一行的索引（不含下一标题行） */
  const push = (lastLine: number) => {
    if (current) {
      current.endLine = Math.max(current.startLine, lastLine);
      current.body = current.body.replace(/\s+$/, '');
      sections.push(current);
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const m = HEADING_RE.exec(lines[i]);
    if (m) {
      push(i - 1);
      current = { title: m[2].trim(), level: m[1].length, body: '', startLine: i, endLine: i };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + lines[i];
    } else if (lines[i].trim()) {
      current = { title: '', level: 0, body: lines[i], startLine: 0, endLine: 0 };
    }
  }
  push(lines.length - 1);
  return sections;
}

function headingLine(section: DocSection): string {
  return section.level > 0 ? `${'#'.repeat(section.level)} ${section.title}` : '';
}

function renderSection(section: DocSection): string {
  const head = headingLine(section);
  if (!head) return section.body;
  return section.body ? `${head}\n\n${section.body}` : head;
}

/**
 * 把 source 中名为 title 的 section 覆盖进 target 的同名 section。
 * 任一侧缺失时：target 缺则该节被追加到末尾（新增），source 缺则原样返回（无内容可恢复）。
 */
export function restoreSection(target: string, source: string, title: string): string {
  const targetSections = extractSections(target);
  const sourceSection = extractSections(source).find((s) => s.title === title);
  if (!sourceSection) return target;
  const targetIndex = targetSections.findIndex((s) => s.title === title);

  if (targetIndex < 0) {
    const trimmed = target.replace(/\s+$/, '');
    return trimmed ? `${trimmed}\n\n${renderSection(sourceSection)}` : renderSection(sourceSection);
  }

  const lines = target.split('\n');
  const targetSection = targetSections[targetIndex];
  const replacement = renderSection(sourceSection).split('\n');
  const before = lines.slice(0, targetSection.startLine);
  const after = lines.slice(targetSection.endLine + 1);
  return [...before, ...replacement, ...after].join('\n');
}

/**
 * 用新正文替换指定标题那一节的 body，标题行与其余章节逐字保留。
 * 章节不存在时抛错由调用方决定如何处理（这里返回原串，保持纯函数无异常）。
 */
export function replaceSectionBody(markdown: string, title: string, newBody: string): string {
  const sections = extractSections(markdown);
  const target = sections.find((s) => s.title === title);
  if (!target) return markdown;
  const lines = markdown.split('\n');
  const head = target.level > 0 ? [`${'#'.repeat(target.level)} ${target.title}`, ''] : [];
  const replacement = newBody.trim() ? [...head, ...newBody.trim().split('\n')] : head.slice(0, 1);
  return [
    ...lines.slice(0, target.startLine),
    ...replacement,
    ...lines.slice(target.endLine + 1),
  ].join('\n');
}

/** 两版本逐节比对：返回并集（按 current 顺序，removed 的追加在末尾）。 */
export function sectionDiff(current: string, previous: string): SectionDiffEntry[] {
  const currentSections = extractSections(current);
  const previousMap = new Map(extractSections(previous).map((s) => [s.title, s]));
  const entries: SectionDiffEntry[] = [];
  const seen = new Set<string>();

  for (const section of currentSections) {
    seen.add(section.title);
    const prev = previousMap.get(section.title);
    if (!prev) {
      entries.push({ title: section.title, level: section.level, status: 'added', changed: true });
      continue;
    }
    const changed = prev.body.trim() !== section.body.trim();
    entries.push({ title: section.title, level: section.level, status: changed ? 'changed' : 'unchanged', changed });
  }
  for (const section of extractSections(previous)) {
    if (!seen.has(section.title)) {
      entries.push({ title: section.title, level: section.level, status: 'removed', changed: true });
    }
  }
  return entries;
}
