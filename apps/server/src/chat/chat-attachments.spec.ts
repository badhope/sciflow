import { describe, expect, it } from 'vitest';
import { prepareChatTurn } from './chat-attachments';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

describe('prepareChatTurn', () => {
  it('merges text attachments into the prompt', async () => {
    const out = await prepareChatTurn('总结', [{ name: 'notes.md', mime: 'text/markdown', data: b64('# 标题\n内容') }]);
    expect(out.message).toContain('总结');
    expect(out.message).toContain('【附件：notes.md】');
    expect(out.message).toContain('# 标题');
    expect(out.parts).toBeUndefined();
  });

  it('turns images into multimodal parts and keeps text', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    const out = await prepareChatTurn('看图', [{ name: 'a.png', mime: 'image/png', data: png }]);
    expect(out.parts?.[0]).toEqual({ type: 'text', text: '看图' });
    expect(out.parts?.[1]).toMatchObject({ type: 'image', mediaType: 'image/png' });
    expect(out.parts?.[1]).toHaveProperty('image', `data:image/png;base64,${png}`);
  });

  it('uses a default prompt when only an image is sent', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    const out = await prepareChatTurn('', [{ name: 'a.png', mime: 'image/png', data: png }]);
    expect(out.message).toContain('请分析我上传的图片');
  });

  it('rejects unsupported binary attachments', async () => {
    await expect(prepareChatTurn('x', [{ name: 'a.zip', mime: 'application/zip', data: b64('zip') }])).rejects.toThrow('不支持的附件类型');
  });

  it('rejects more than four attachments', async () => {
    const one = { name: 'a.txt', mime: 'text/plain', data: b64('a') };
    await expect(prepareChatTurn('x', Array(5).fill(one))).rejects.toThrow('最多上传');
  });
});
