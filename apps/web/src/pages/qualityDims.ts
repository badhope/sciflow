/** 质量评分维度（单一来源，被 QualityPage / WritingPage 共享） */
export const QUALITY_DIMS = [
  { key: 'literature', label: '文献综述与覆盖' },
  { key: 'logic', label: '论证与逻辑' },
  { key: 'citation', label: '引用规范与可溯性' },
  { key: 'language', label: '学术语言' },
  { key: 'novelty', label: '贡献与创新' },
  { key: 'figures', label: '结构与图表规范' },
  { key: 'format', label: '格式与著录规范' },
] as const;

export type QualityDimKey = (typeof QUALITY_DIMS)[number]['key'];
