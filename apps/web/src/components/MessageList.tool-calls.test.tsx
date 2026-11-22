import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MessageList } from './MessageList';
import type { ChatMessage } from '../lib/chat-session';

const base = {
  role: 'assistant' as const,
  content: '工具已经执行完毕。',
};

describe('MessageList 工具调用卡', () => {
  it('失败的工具不再显示成功勾，展开能看到错误原因', async () => {
    const messages: ChatMessage[] = [{
      ...base,
      toolCalls: [{ id: 'call-1', name: 'document.update', arguments: '{}', status: 'error', error: '文档不存在', durationMs: 42 }],
    }];
    render(<MessageList messages={messages} empty={null} />);

    expect(screen.getByText(/工具调用 · 1 次/)).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/工具调用 · 1 次/));
    expect(screen.getByText('文档不存在')).toBeInTheDocument();
  });

  it('旧消息没有结果事件时标为“状态未记录”，不伪造完成', async () => {
    const messages: ChatMessage[] = [{
      ...base,
      toolCalls: [{ name: 'project.list', arguments: '{}' }],
    }];
    render(<MessageList messages={messages} empty={null} />);

    expect(screen.getByText('状态未记录')).toBeInTheDocument();
  });

  it('成功结果展示返回预览和耗时', async () => {
    const messages: ChatMessage[] = [{
      ...base,
      toolCalls: [{
        id: 'call-2', name: 'project.list', arguments: '{}', status: 'done', durationMs: 18,
        result: '2 个项目：A、B', resultChars: 12,
      }],
    }];
    render(<MessageList messages={messages} empty={null} />);

    expect(screen.getByText('完成')).toBeInTheDocument();
    expect(screen.getByText('18ms')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/工具调用 · 1 次/));
    expect(screen.getByText('2 个项目：A、B')).toBeInTheDocument();
  });
});
