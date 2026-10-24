import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Eye, FileText, Loader2, Pencil } from 'lucide-react';
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { Doc } from '../../types';
import { Badge, Card } from '../../components/ui';
import { SplitPane } from '../../components/SplitPane';

/**
 * WritingEditor — 中间编辑/预览主区。
 * 编辑器：CodeMirror 6（@uiw/react-codemirror + markdown 模式），替代裸 Textarea：
 * 语法高亮 / 行号 / 折行 / 括号配对；keep 的 DOM 契约见下方 handle。
 *
 * 行为说明：
 *  - 标题 blur 回调给父组件（父组件持 doc/docs state，update API 后 refresh 列表）
 *  - 模式切换回调给父组件（editorMode 位于父级）
 *  - 光标插入契约：父组件（WritingPage）经由 `getWritingEditorHandle()` 取
 *    `{ getCursor, setCursor }` 做引用锚点/实验结论的跨组件光标定位。
 */

export interface WritingEditorHandle {
  /** 当前光标（选区起点）；编辑器未挂载返回 null */
  getCursor(): number | null;
  /** 聚焦并把光标放到指定位置 */
  setCursor(pos: number): void;
}

let handle: WritingEditorHandle | null = null;

/** 供 WritingPage 等父级组件获取编辑器句柄（挂载后可用，卸载即失效） */
export function getWritingEditorHandle(): WritingEditorHandle | null {
  return handle;
}

export function WritingEditor({
  doc,
  content,
  editorMode,
  savedAt,
  saveState = 'idle',
  onRetrySave,
  onChangeContent,
  onTitleBlur,
  onModeChange,
  renderPreview,
}: {
  doc: Doc;
  content: string;
  editorMode: 'edit' | 'preview' | 'split';
  savedAt: number | null;
  /** 自动保存状态：saving / error 时必须有可见反馈（历史缺陷：失败静默但显示已保存） */
  saveState?: 'idle' | 'saving' | 'error';
  onRetrySave?: () => void;
  onChangeContent: (v: string) => void;
  /** 标题 blur 事件：传入新标题字符串；父组件负责 API 更新与状态同步 */
  onTitleBlur: (newTitle: string) => void;
  onModeChange: (mode: 'edit' | 'preview' | 'split') => void;
  /** 预览区 JSX 插槽（WritingPreview 由父组件组装后传入） */
  renderPreview: React.ReactNode;
}) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  // 暗色跟随（App 在 <html> 上切换 .dark 类）
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    handle = {
      getCursor: () => {
        const view = cmRef.current?.view;
        if (!view) return null;
        return view.state.selection.main.head;
      },
      setCursor: (pos: number) => {
        const view = cmRef.current?.view;
        if (!view) return;
        view.focus();
        view.dispatch({ selection: { anchor: pos } });
      },
    };
    return () => {
      handle = null;
    };
  }, []);

  const editorNode = (
    <CodeMirror
      ref={cmRef}
      value={content}
      onChange={onChangeContent}
      height="100%"
      theme={dark ? 'dark' : 'light'}
      extensions={[markdown({ base: markdownLanguage }), EditorView.lineWrapping]}
      placeholder="在这里撰写论文正文（支持 Markdown）…下方「AI 工具」可做大纲生成、章节起草、润色、翻译、降重"
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: false }}
      style={{ height: '100%' }}
    />
  );

  return (
    <Card className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
        <input
          key={doc.id}
          className="font-medium text-slate-800 dark:text-slate-100 outline-none flex-1 bg-transparent min-w-0"
          aria-label="文档标题"
          defaultValue={doc.title}
          onBlur={(e) => {
            const t = e.target.value.trim();
            if (t && t !== doc.title) onTitleBlur(t);
          }}
        />
        {saveState === 'saving' ? (
          <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0" role="status"><Loader2 size={12} className="animate-spin" />保存中…</span>
        ) : saveState === 'error' ? (
          <button className="text-xs text-rose-600 flex items-center gap-1 shrink-0" role="alert" onClick={onRetrySave} title="保存失败，点击重试">
            <AlertCircle size={12} />保存失败，重试
          </button>
        ) : savedAt ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 page-in shrink-0"><Check size={12} />已保存</span>
        ) : null}
        <Badge tone="blue">v{doc.version}</Badge>
        {/* Markdown 预览切换（编辑 / 预览 / 分栏，科研写作标配） */}
        <div className="flex items-center gap-0.5 ml-auto bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 shrink-0">
          {(['edit', 'split', 'preview'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              title={m === 'edit' ? '编辑' : m === 'preview' ? '预览' : '分栏'}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-all duration-150 ${
                editorMode === m ? 'bubble-user shadow-sm shadow-teal-600/25' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {m === 'edit' ? <Pencil size={11} /> : m === 'preview' ? <Eye size={11} /> : <FileText size={11} />}
              {m === 'edit' ? '编辑' : m === 'preview' ? '预览' : '分栏'}
            </button>
          ))}
        </div>
      </div>
      {editorMode === 'split' ? (
        <SplitPane
          storageKey="sciflow:writing-split"
          initial={0.5}
          min={0.25}
          max={0.78}
          left={
            <div id="sciflow-editor" className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden text-[13.5px] border-r border-slate-100 dark:border-slate-800">
              <div className="absolute inset-0">{editorNode}</div>
            </div>
          }
          right={<div className="flex h-full min-h-0 min-w-0 flex-1">{renderPreview}</div>}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {editorMode === 'edit' ? (
            <div id="sciflow-editor" className="relative h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden text-[13.5px]">
              <div className="absolute inset-0">{editorNode}</div>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1">{renderPreview}</div>
          )}
        </div>
      )}
    </Card>
  );
}
