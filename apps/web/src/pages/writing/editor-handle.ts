/**
 * 编辑器句柄注册表（轻量模块，零依赖）。
 *
 * 为什么单独一个文件：WritingEditor 里静态 import 了 CodeMirror（约 300KB），
 * 而 WritingPage 需要在首屏就拿到「插入引用到光标处」的句柄。若把 getWritingEditorHandle
 * 放在 WritingEditor 内部，父页面静态 import 它就会把 CodeMirror 拉回首屏 chunk
 * （懒加载失效）。把句柄拆到本文件后，编辑器 chunk 可以真正按需加载。
 */
export interface WritingEditorHandle {
  /** 当前光标（选区起点）；编辑器未挂载返回 null */
  getCursor(): number | null;
  /** 聚焦并把光标放到指定位置 */
  setCursor(pos: number): void;
  /** 撤销一步（编辑器未挂载时为空操作） */
  undo?: () => void;
  /** 重做一步（编辑器未挂载时为空操作） */
  redo?: () => void;
  /** 是否还能撤销/重做（用于按钮禁用态） */
  canUndo?: () => boolean;
  canRedo?: () => boolean;
}

let handle: WritingEditorHandle | null = null;

/** 由编辑器组件在挂载/卸载时调用；页面侧只读 */
export function registerWritingEditorHandle(h: WritingEditorHandle | null): void {
  handle = h;
}

/** 供 WritingPage 等父级组件获取编辑器句柄（挂载后可用，卸载即失效） */
export function getWritingEditorHandle(): WritingEditorHandle | null {
  return handle;
}
