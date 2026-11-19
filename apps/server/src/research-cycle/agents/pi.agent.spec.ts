import { describe, expect, it, vi } from 'vitest';
import { planWithPi } from './pi.agent';

describe('PI brief injection', () => {
  it('项目 Brief 进入用户提示块，约束/成功标准不会丢', async () => {
    const completeStructured = vi.fn().mockResolvedValue({ questionEcho: 'q' });
    const ai = { completeStructured } as never;
    await planWithPi(ai, {
      question: '低资源分类',
      iteration: 0,
      brief: '项目研究 Brief：\n研究问题：低资源分类\n约束：单卡 24G\n成功标准：F1 +2',
    });
    const messages = completeStructured.mock.calls[0][0] as { role: string; content: string }[];
    const user = messages.find((m) => m.role === 'user')!;
    expect(user.content).toContain('项目研究 Brief');
    expect(user.content).toContain('单卡 24G');
    expect(user.content).toContain('F1 +2');
  });

  it('没有 Brief 时不产生空提示块', async () => {
    const completeStructured = vi.fn().mockResolvedValue({ questionEcho: 'q' });
    const ai = { completeStructured } as never;
    await planWithPi(ai, { question: 'q', iteration: 0 });
    const content = (completeStructured.mock.calls[0][0] as { role: string; content: string }[])[1].content;
    expect(content).not.toContain('项目研究 Brief');
  });
});
