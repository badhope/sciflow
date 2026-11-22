import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastContext } from '../App';
import type { LongformBookDetail } from '../api/longform';
import type { Project } from '../types';
import { LongformPage } from './LongformPage';

const listMock = vi.fn();
const getMock = vi.fn();
const writeMock = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    longform: {
      list: (...a: unknown[]) => listMock(...a),
      get: (...a: unknown[]) => getMock(...a),
      write: (...a: unknown[]) => writeMock(...a),
      writeNext: vi.fn(),
      consistency: vi.fn(),
      compile: vi.fn(),
      create: vi.fn(),
      addVolume: vi.fn(),
    },
  },
}));

const project: Project = { id: 'p1', name: '测试项目', description: '', status: 'active', createdAt: 0, updatedAt: 0 };
const book: LongformBookDetail = {
  id: 'book-1', projectId: 'p1', title: '雾港来信', premise: '', styleHint: '', targetCharsPerChapter: 2500,
  status: 'writing', createdAt: 0, updatedAt: 0,
  volumes: [{ id: 'vol-1', bookId: 'book-1', seq: 1, title: '第一卷', goal: '', createdAt: 0 }],
  chapters: [{
    id: 'ch-1', bookId: 'book-1', volumeId: 'vol-1', seq: 1, title: '潮汐', goal: '建立悬念', beats: '',
    entities: '', content: '海雾漫过码头，林晚把信压在灯下。', summary: '', chars: 18, status: 'done', error: '', createdAt: 0, updatedAt: 0,
  }],
  stats: { total: 2, done: 1, pending: 1, failed: 0, chars: 18 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastContext.Provider value={vi.fn()}>
        <LongformPage project={project} />
      </ToastContext.Provider>
    </QueryClientProvider>,
  );
}

describe('LongformPage', () => {
  beforeEach(() => {
    listMock.mockReset();
    getMock.mockReset();
    writeMock.mockReset();
    listMock.mockResolvedValue([book]);
    getMock.mockResolvedValue(book);
  });

  it('点击章节卡片可查看正文，不再只有状态摘要', async () => {
    renderPage();
    expect(await screen.findByText('第 1 章 · 潮汐')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('查看第 1 章正文'));

    expect(await screen.findByText('海雾漫过码头，林晚把信压在灯下。')).toBeInTheDocument();
    expect(screen.getByText('复制正文')).toBeInTheDocument();
    expect(screen.getByText('下载本章')).toBeInTheDocument();
  });

  it('连写章数可调，按用户输入调用批量写作', async () => {
    writeMock.mockResolvedValue({
      stopped: false, written: [{ seq: 2, title: '来信', chars: 100 }],
      failures: [], stats: { total: 2, done: 2, pending: 0, failed: 0, chars: 118 }, allDone: false,
    });
    renderPage();
    const input = await screen.findByLabelText('连写章数');
    fireEvent.change(input, { target: { value: '5' } });
    await userEvent.click(screen.getByText('连写 5 章'));

    expect(writeMock).toHaveBeenCalledWith('book-1', 5);
  });
});
