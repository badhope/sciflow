/**
 * 流水线步骤的单一事实来源。
 *
 * 历史问题：步骤清单一共存在四份（server 的 STEPS、customization 的可配置清单、
 * graph 里硬编码的 stepEnabled 调用、web 的 STEP_LABELS），四处互不一致——
 * 用户在设置页关掉「分章起草」写进了 pipeline_config，但 graph 从不读这个 key；
 * 而 graph 唯一读的 `figures` 又不在任何 UI 清单里，用户根本配不出来。
 *
 * 现在 server / web 共用本常量：
 *  - key    ：graph 与前端共用的唯一标识
 *  - label  ：中文展示名
 *  - core   ：骨架步骤，不可禁用
 *  - configurable：是否允许在设置页开关（graph 必须读同名 key）
 *  - uiStep ：是否作为 UI 步骤条的一项展示（`drafting` 在 graph 中并入 quality-gate，故为 false）
 */

export interface PipelineStepDef {
  key: string;
  label: string;
  core: boolean;
  configurable: boolean;
  uiStep: boolean;
}

export const PIPELINE_STEPS: readonly PipelineStepDef[] = [
  { key: 'topic-verify', label: '主题验证', core: true, configurable: false, uiStep: true },
  // v1.7：选题新颖性预检（对标 Elicit / Undermind 的 "is this already done?"）——
  // 在花 token 做文献调研与起草之前，先用学术库近作比对，重叠过高时给出改题建议。
  { key: 'novelty-check', label: '新颖性预检', core: false, configurable: true, uiStep: true },
  { key: 'literature', label: '文献调研', core: false, configurable: true, uiStep: true },
  { key: 'outline', label: '大纲生成', core: false, configurable: true, uiStep: true },
  // 起草在 graph 内部由 quality-gate 节点调用 runDrafting 完成，不是独立节点；
  // 因此不作为 UI 步骤展示，但保留为可配置项——关掉它即跳过起草（直接进评审）。
  { key: 'drafting', label: '分章起草', core: false, configurable: true, uiStep: false },
  { key: 'quality-gate', label: '质量门评分', core: false, configurable: true, uiStep: true },
  { key: 'figures', label: '自动配图', core: false, configurable: true, uiStep: false },
  { key: 'polish', label: '润色定稿', core: false, configurable: true, uiStep: true },
  { key: 'citation-format', label: '引用格式化', core: false, configurable: true, uiStep: true },
  { key: 'complete', label: '完成', core: true, configurable: false, uiStep: true },
] as const;

/** UI 步骤条里展示的步骤（按顺序） */
export const PIPELINE_UI_STEPS = PIPELINE_STEPS.filter((s) => s.uiStep);



/** 合法步骤 key 集合（供 stepEnabled / 设置接口做白名单校验） */
export const PIPELINE_STEP_KEYS = new Set(PIPELINE_STEPS.map((s) => s.key));
