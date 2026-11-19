import { describe, expect, it, vi } from 'vitest';
import { McpService } from './mcp.service';

/** 投稿工具必须可被 MCP 客户端发现；AI/DB 细节由 SubmissionService 自身测试覆盖。 */
describe('MCP submission tools', () => {
  const submission = {
    matchJournals: vi.fn(async () => ({ journals: [] })),
    createTrack: vi.fn(async () => ({ ok: true })),
    coverLetter: vi.fn(),
    replyReview: vi.fn(),
    listTracks: vi.fn(),
    parseTrackEmail: vi.fn(),
  };
  const svc = new (McpService as any)(...Array.from({ length: 12 }, () => ({})), submission) as McpService;
  const byName = new Map(svc.list().map((t) => [t.name, t]));

  it('exposes the full submission tool surface', () => {
    for (const name of ['submission.match', 'submission.cover', 'submission.reply', 'submission.track', 'submission.email', 'submission.track.create']) {
      expect(byName.has(name)).toBe(true);
    }
  });

  it('declares the required inputs the UI forms rely on', () => {
    expect(byName.get('submission.match')!.inputSchema.required).toBeUndefined();
    expect(byName.get('submission.cover')!.inputSchema.required).toEqual(['journal']);
    expect(byName.get('submission.reply')!.inputSchema.required).toEqual(['reviewComments']);
    expect(byName.get('submission.track')!.inputSchema.required).toEqual(['projectId']);
    expect(byName.get('submission.email')!.inputSchema.required).toEqual(['emailText']);
    expect(byName.get('submission.track.create')!.inputSchema.required).toEqual(['projectId', 'journalName']);
  });

  it('routes submission.match to the service', async () => {
    const res = await svc.call('submission.match', { title: '图神经网络', abstract: '摘要' });
    expect(res.isError).toBeUndefined();
    expect(submission.matchJournals).toHaveBeenCalledWith('图神经网络', '摘要');
  });
});
