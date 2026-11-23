import type { Outline } from '../../types';

/**
 * 大纲模板（路线图 #17）：纯本地 JSON 预制，零 AI 调用、零新依赖。
 * 用法：WritingPage 大纲栏「套用模板」下拉 → 直接写入文档 outline（PATCH /documents/:id）。
 */

const template = (title: string, sections: string[]): Outline => ({
  title,
  sections: sections.map((t) => ({ title: t, subsections: [] })),
});

export const OUTLINE_TEMPLATES: { key: string; label: string; build: (topic: string) => Outline }[] = [
  {
    key: 'review',
    label: '综述（Review）',
    build: (topic) =>
      template(`${topic}：研究综述`, [
        '引言',
        '研究背景与问题定义',
        '方法演进与代表性工作',
        '关键技术对比与分类',
        '应用场景与实证结果',
        '挑战与未来方向',
        '结论',
      ]),
  },
  {
    key: 'imrad',
    label: '论文（IMRaD 实证）',
    build: (topic) =>
      template(topic, ['Introduction 引言', 'Methods 方法', 'Results 结果', 'Discussion 讨论', 'Conclusion 结论']),
  },
  {
    key: 'presentation',
    label: '演示报告（PPT）',
    build: (topic) =>
      template(`${topic}：汇报演示`, [
        '研究背景与问题',
        '研究现状与缺口',
        '研究目标与假设',
        '方法与技术路线',
        '实验设计与数据',
        '主要结果与发现',
        '结论、贡献与展望',
        '致谢',
      ]),
  },
  {
    key: 'grant',
    label: '开题 / 基金提案',
    build: (topic) =>
      template(`${topic}（项目申请书）`, [
        '立项依据与研究意义',
        '国内外研究现状及分析',
        '研究目标、研究内容与拟解决的关键问题',
        '研究方案与技术路线',
        '可行性分析',
        '预期成果与考核指标',
        '研究基础与工作条件',
        '进度安排',
      ]),
  },
];
