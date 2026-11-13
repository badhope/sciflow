/**
 * WritingPage 子组件共享的引用样式定义与格式化工具函数。
 * 从原 WritingPage.tsx 抽出，避免循环依赖。
 */

/** 引用样式元数据：8 种 CSL 样式 + bibtex（全部由服务端 citation-js 渲染） */
export type CiteStyleMeta = { value: string; label: string; inText: string; numbered: boolean };

export const CITE_STYLES: CiteStyleMeta[] = [
  { value: 'apa', label: 'APA 7', inText: '(Author, Year)', numbered: false },
  { value: 'ieee', label: 'IEEE', inText: '[n]', numbered: true },
  { value: 'vancouver', label: 'Vancouver', inText: '[n]', numbered: true },
  { value: 'gbt', label: 'GB/T 7714', inText: '[n]', numbered: true },
  { value: 'nature', label: 'Nature', inText: '[n]', numbered: true },
  { value: 'chicago', label: 'Chicago 著者-年', inText: '(Surname Year)', numbered: false },
  { value: 'springer', label: 'Springer（著者-年）', inText: '(Surname Year)', numbered: false },
  { value: 'acs', label: 'ACS', inText: '[n]', numbered: true },
];
