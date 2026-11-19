import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../lib/chat-session';
import { AgentChatThread } from './AgentChat';

vi.mock('./MessageList', () => ({
  MessageList: ({ messages }: { messages: ChatMessage[] }) => (
    <div data-testid="message-list">{messages.map((m) => m.content).join('|')}</div>
  ),
}));

describe('AgentChatThread', () => {
  it('renders empty/header/messages/children in the shared chat contract', () => {
    render(
      <AgentChatThread
        messages={[{ role: 'assistant', content: '你好' }]}
        streaming={false}
        testId="thread"
        empty={<div>空状态</div>}
        header={<div>任务清单</div>}
      >
        <div>流水线卡</div>
      </AgentChatThread>,
    );

    const thread = screen.getByTestId('thread');
    expect(thread.textContent).toBe('任务清单你好流水线卡');
    expect(screen.queryByText('空状态')).toBeNull();
    expect(screen.getByTestId('message-list').textContent).toBe('你好');
  });

  it('shows the empty slot only when there are no messages', () => {
    render(<AgentChatThread messages={[]} streaming={false} empty={<div>空状态</div>} />);
    expect(screen.getByText('空状态')).toBeTruthy();
  });
});
