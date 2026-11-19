import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    documents: {
      polish: vi.fn(),
      translate: vi.fn(),
      abstract: vi.fn(),
    },
  },
}));

import { api } from '../api/client';
import { useDocumentActions } from './document-actions';

const mocked = api.documents as unknown as {
  polish: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  abstract: ReturnType<typeof vi.fn>;
};

afterEach(() => vi.clearAllMocks());

describe('useDocumentActions', () => {
  it('routes all three document actions through the same doc id and target params', async () => {
    mocked.polish.mockResolvedValue({ original: 'a', polished: 'b', reason: 'r' });
    mocked.translate.mockResolvedValue({ translated: 't' });
    mocked.abstract.mockResolvedValue({ abstract: 'a', keywords: ['k'] });
    const { result } = renderHook(() => useDocumentActions('doc-1'));

    act(() => { void result.current.polish('正文', 'reduce'); });
    expect(mocked.polish).toHaveBeenCalledWith('doc-1', '正文', 'reduce');

    await act(async () => { await result.current.translate('正文', 'zh'); });
    expect(mocked.translate).toHaveBeenCalledWith('doc-1', '正文', 'zh');

    await act(async () => { await result.current.abstract(); });
    expect(mocked.abstract).toHaveBeenCalledWith('doc-1');
    expect(result.current.busy).toBeNull();
  });

  it('rejects without a document and surfaces the API error in state', async () => {
    const noDoc = renderHook(() => useDocumentActions(null));
    await expect(noDoc.result.current.abstract()).rejects.toThrow('请先选择一篇文档');

    mocked.polish.mockRejectedValue(new Error('润色失败'));
    const { result } = renderHook(() => useDocumentActions('doc-2'));
    await act(async () => {
      await expect(result.current.polish('正文')).rejects.toThrow('润色失败');
    });
    expect(result.current.error).toBe('润色失败');
  });
});
