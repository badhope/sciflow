// @vitest-environment node
/**
 * msw 集成测试：用网络层拦截（而非模块 mock）验证 client.ts 的真实请求/错误转译路径。
 * 覆盖：成功 JSON 解析、后端中文业务错误透传、状态码→友好中文映射（friendlyError）。
 * node 环境：happy-dom 自带 fetch 会绕过 msw 的 undici 拦截，故本文件用 node env + 最小 window 垫片。
 */
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// API_BASE 在模块求值时读取 window.sciflowDesktop（桌面注入）；node 环境下用最小垫片先注入再动态导入
(globalThis as unknown as { window: { sciflowDesktop: { apiBase: string } } }).window = { sciflowDesktop: { apiBase: 'http://msw.test' } };

const server = setupServer(
  http.get('http://msw.test/api/documents', () =>
    HttpResponse.json([{ id: 'd1', projectId: 'p1', title: '拦截到的文档', content: '', version: 1, status: 'draft', createdAt: 0, updatedAt: 0, outline: '[]', versions: '[]' }]),
  ),
  http.post('http://msw.test/api/pipeline', () =>
    HttpResponse.json({ message: '请先输入研究主题', error: 'Bad Request', statusCode: 400 }, { status: 400 }),
  ),
  http.get('http://msw.test/api/boom', () => HttpResponse.json({ message: 'kaboom' }, { status: 500 })),
);

beforeAll(() => server.listen());
afterAll(() => server.close());

describe('api client × msw（网络层拦截）', () => {
  it('GET 成功：返回解析后的 JSON 数组', async () => {
    const { api } = await import('./client');
    const docs = await api.documents.list('p1');
    expect(Array.isArray(docs)).toBe(true);
    expect(docs[0].title).toBe('拦截到的文档');
  });

  it('后端中文业务错误：原样透传 message（不覆盖为状态码文案）', async () => {
    const { api } = await import('./client');
    await expect(api.pipeline.create('p1', '')).rejects.toMatchObject({ message: expect.stringContaining('请先输入研究主题') });
  });

  it('英文错误 + 500：转译为友好中文提示', async () => {
    // 走真实的 request() 出口，而不是裸 fetch——否则测不到错误翻译层。
    // /api/boom 返回 message="kaboom"（非中文）且状态 500，应被翻译成状态码对应的中文。
    const { request } = await import('./core');
    await expect(request('/api/boom')).rejects.toMatchObject({ message: expect.stringMatching(/服务内部错误|请求失败/) });
    // 且错误必须携带状态码，便于上层区分「服务端故障」与「网络不通」
    await expect(request('/api/boom')).rejects.toMatchObject({ status: 500 });
  });

  /**
   * 回归护栏（2026-10）：此前 catch 用字符类 /^[请求服务网络未授权没有操作]/ 判首字，
   * 导致 74/87 条后端中文错误被覆盖成"无法连接服务器"。这里专门挑首字不在该集合里的文案。
   */
  it('首字不在旧白名单里的中文业务错误，也要原样透传', async () => {
    server.use(
      http.post('http://msw.test/api/quality', () =>
        HttpResponse.json({ message: '文档内容过短，暂无法评分（至少 50 字）', error: 'Bad Request', statusCode: 400 }, { status: 400 }),
      ),
    );
    const { api } = await import('./client');
    await expect(api.quality.review('d1', 't', 'x')).rejects.toMatchObject({ message: expect.stringContaining('文档内容过短，暂无法评分') });
  });

  it('网络失败：给出可识别的连接提示（而不是吞成通用错误）', async () => {
    server.use(http.get('http://msw.test/api/offline', () => HttpResponse.error()));
    const { request } = await import('./core');
    await expect(request('/api/offline')).rejects.toMatchObject({ message: expect.stringContaining('无法连接服务器') });
  });
});
