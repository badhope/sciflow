import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { agentBackgroundJobs } from '../db/schema';
import { BackgroundRunService } from './background-run.service';

const PROJ = 'test-background-run';

function cleanup() {
  db.delete(agentBackgroundJobs).where(eq(agentBackgroundJobs.projectId, PROJ)).run();
}

async function waitFor<T>(fn: () => T | undefined, timeout = 5_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = fn();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor timeout');
}

async function waitUntil(fn: () => boolean, timeout = 5_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitUntil timeout');
}

describe('BackgroundRunService', () => {
  beforeEach(cleanup);

  it('returns immediately, records run/tokens/output when the chat finishes', async () => {
    const answer = vi.fn(async (_m: string, _h: unknown[], _p: string, _d: unknown, opts: any) => {
      opts.onRunStarted?.('run-bg-1');
      opts.onUsage?.({ totalTokens: 123 });
      return { answer: '后台完成', sources: [] };
    });
    const service = new BackgroundRunService({ answer } as never);
    const job = service.start({ projectId: PROJ, message: '后台任务', sessionKey: 's1' });
    expect(job.status).toBe('queued');
    const done = await waitFor(() => {
      const row = service.list(PROJ).find((j) => j.id === job.id);
      return row?.status === 'done' ? row : undefined;
    });
    expect(done.output).toBe('后台完成');
    expect(done.runId).toBe('run-bg-1');
    expect(done.totalTokens).toBe(123);
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it('runs different sessions in parallel up to the global limit', async () => {
    let active = 0;
    let maxActive = 0;
    const answer = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 200));
      active -= 1;
      return { content: 'ok', sources: [] };
    });
    const service = new BackgroundRunService({ answer } as never);
    service.start({ projectId: PROJ, message: 'a', sessionKey: 's1' });
    service.start({ projectId: PROJ, message: 'b', sessionKey: 's2' });
    await waitUntil(() => service.list(PROJ).filter((j) => j.status === 'done').length === 2);
    expect(maxActive).toBe(2);
  });

  it('serializes the same session but allows different sessions to run concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    const answer = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 80));
      active -= 1;
      return { answer: 'ok', sources: [] };
    });
    const service = new BackgroundRunService({ answer } as never);
    service.start({ projectId: PROJ, message: 'a', sessionKey: 'same' });
    service.start({ projectId: PROJ, message: 'b', sessionKey: 'same' });
    await waitUntil(() => service.list(PROJ).filter((j) => j.status === 'done').length === 2);
    expect(maxActive).toBe(1);
  });

  it('aborts a running job and does not overwrite cancelled with done', async () => {
    const answer = vi.fn((_m: string, _h: unknown[], _p: string, _d: unknown, opts: any) =>
      new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      }),
    );
    const service = new BackgroundRunService({ answer } as never);
    const job = service.start({ projectId: PROJ, message: 'long task', sessionKey: 's4' });
    await waitFor(() => (service.get(job.id).status === 'running' ? true : undefined));
    const cancelled = service.cancel(job.id);
    expect(cancelled.status).toBe('cancelled');
    await waitUntil(() => service.get(job.id).status === 'cancelled');
  });

  it('cancels a queued job without calling the model', async () => {
    const answer = vi.fn(async () => ({ answer: 'ok', sources: [] }));
    const service = new BackgroundRunService({ answer } as never);
    const job = service.start({ projectId: PROJ, message: 'cancel me', sessionKey: 's3' });
    const cancelled = service.cancel(job.id);
    expect(cancelled.status).toBe('cancelled');
    await new Promise((r) => setTimeout(r, 100));
    expect(answer).not.toHaveBeenCalled();
  });
});
