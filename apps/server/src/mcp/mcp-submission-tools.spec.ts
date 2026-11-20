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
  const submissionPackage = {
    build: vi.fn(async () => ({
      filename: '测试-投稿包.zip', size: 1234, files: [], journal: '', template: { key: 'generic', label: '通用', note: '' }, figures: [],
      ready: true, score: 100, failCount: 0, warnCount: 0, base64: 'SHOULD_NOT_LEAK', projectId: 'p', documentId: 'd',
    })),
  };
  const svc = new (McpService as any)(
    ...Array.from({ length: 12 }, () => ({})), submission,
    ...Array.from({ length: 3 }, () => ({})), submissionPackage,
  ) as McpService;
  (svc as any).access = { assertProject: () => {}, assertDocument: () => {} };
  const byName = new Map(svc.list().map((t) => [t.name, t]));

  it('exposes the full submission tool surface', () => {
    for (const name of ['submission.match', 'submission.cover', 'submission.reply', 'submission.track', 'submission.email', 'submission.track.create', 'submission.package']) {
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

  it('submission.package returns manifest summary, never base64', async () => {
    const res = await svc.call('submission.package', { projectId: 'p', documentId: 'd', journal: 'Nature', template: 'nature' });
    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(String((res.content as any[])[0].text));
    expect(payload.filename).toBe('测试-投稿包.zip');
    expect(payload.downloadPath).toContain('/api/submission/package?');
    expect(JSON.stringify(payload)).not.toContain('SHOULD_NOT_LEAK');
    expect(submissionPackage.build).toHaveBeenCalledWith('p', 'd', { journal: 'Nature', template: 'nature' });
  });

  it('routes submission.match to the service', async () => {
    const res = await svc.call('submission.match', { title: '图神经网络', abstract: '摘要' });
    expect(res.isError).toBeUndefined();
    expect(submission.matchJournals).toHaveBeenCalledWith('图神经网络', '摘要');
  });
});
