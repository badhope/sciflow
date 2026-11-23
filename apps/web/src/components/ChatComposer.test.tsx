import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatComposer';

const base = { value: '', onValueChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn(), streaming: false };

describe('ChatComposer', () => {
  it('空输入不可发送，填写后可发送', () => {
    const onSend = vi.fn();
    const { rerender } = render(<ChatComposer {...base} onSend={onSend} testId="c" />);
    const send = screen.getByTitle('发送') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    rerender(<ChatComposer {...base} value="写一段综述" onSend={onSend} testId="c" />);
    expect((screen.getByTitle('发送') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTitle('发送'));
    expect(onSend).toHaveBeenCalled();
  });

  it('只有附件也可发送；附件可移除', () => {
    const onSend = vi.fn();
    const onRemoveAttachment = vi.fn();
    render(<ChatComposer {...base} onSend={onSend} attachments={[{ name: 'paper.pdf', mime: 'application/pdf' }]} onRemoveAttachment={onRemoveAttachment} />);
    expect(screen.getByText('paper.pdf')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('移除 paper.pdf'));
    expect(onRemoveAttachment).toHaveBeenCalledWith(0);
    expect((screen.getByTitle('发送') as HTMLButtonElement).disabled).toBe(false);
  });

  it('流式中显示停止按钮', () => {
    const onStop = vi.fn();
    render(<ChatComposer {...base} streaming onStop={onStop} />);
    fireEvent.click(screen.getByTitle('停止生成（Esc）'));
    expect(onStop).toHaveBeenCalled();
  });

  it('slash 菜单渲染并回填指令', () => {
    const onApply = vi.fn();
    render(<ChatComposer {...base} slash={{ open: true, active: 0, items: [{ name: 'search', desc: '检索' } as never], onApply }} />);
    fireEvent.click(screen.getByText('/search'));
    expect(onApply).toHaveBeenCalled();
  });
});
