import { comboLabel } from './hotkeys';

/**
 * 快捷键速查表（F-3.2 收尾）：设置页渲染的唯一数据源。
 * 纪律：本表必须与真实注册一一对应——测试遍历本表断言 combo 不重复、
 * scope 合法；注册点变更（App/WritingPage/WorkspacePage 的 useHotkeys）必须同步本表。
 */
export interface HotkeyDoc {
  /** 组合键（与 useHotkeys 注册的 combo 同写法） */
  combo: string;
  label: string;
  scope: '全局' | '写作页' | '工作台';
  allowInInput?: boolean;
}

export const HOTKEY_DOCS: HotkeyDoc[] = [
  { combo: 'mod+k', label: '打开 / 关闭命令面板', scope: '全局' },
  { combo: 'mod+n', label: '新建研究项目', scope: '全局' },
  { combo: 'escape', label: '关闭命令面板', scope: '全局', allowInInput: true },
  { combo: 'mod+s', label: '保存文档（自动记录历史版本）', scope: '写作页' },
  { combo: 'mod+b', label: '切换大纲 / 工具面板', scope: '写作页' },
  { combo: 'escape', label: '停止 AI 生成（保留已收文本）', scope: '工作台', allowInInput: true },
];

/** 速查表展示用：把 combo 渲染成平台习惯写法（Mac ⌘ / Win Ctrl） */
export function hotkeyLabel(doc: HotkeyDoc): string {
  return comboLabel(doc.combo);
}
