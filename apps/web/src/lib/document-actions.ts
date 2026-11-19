import { useCallback, useState } from 'react';
import { api } from '../api/client';

export type DocumentActionKind = 'polish' | 'reduce' | 'translate' | 'abstract';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 文档级 AI 动作的唯一调用点。
 *
 * 写作页与写作助手此前各自调 `api.documents.polish/translate/abstract`，
 * 三态、错误文案和参数默认值容易分叉。这里只统一“调用 + busy/error”，
 * 结果怎么展示（回写正文 / 先预览再应用）仍由页面决定。
 */
export function useDocumentActions(docId: string | null) {
  const [busy, setBusy] = useState<DocumentActionKind | null>(null);
  const [error, setError] = useState('');

  const run = useCallback(
    async <T,>(kind: DocumentActionKind, fn: (id: string) => Promise<T>): Promise<T> => {
      if (!docId) throw new Error('请先选择一篇文档');
      setBusy(kind);
      setError('');
      try {
        return await fn(docId);
      } catch (e: unknown) {
        setError(errorText(e));
        throw e;
      } finally {
        setBusy(null);
      }
    },
    [docId],
  );

  const polish = useCallback(
    (text: string, mode: 'polish' | 'reduce' = 'polish') => run(mode, (id) => api.documents.polish(id, text, mode)),
    [run],
  );

  const translate = useCallback(
    (text: string, targetLang: 'zh' | 'en' = 'en') => run('translate', (id) => api.documents.translate(id, text, targetLang)),
    [run],
  );

  const abstract = useCallback(() => run('abstract', (id) => api.documents.abstract(id)), [run]);

  return { busy, error, polish, translate, abstract };
}
