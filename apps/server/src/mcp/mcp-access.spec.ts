import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects } from '../db/schema';
import { ProjectAccessService } from '../common/project-access.service';
import { McpService } from './mcp.service';

/**
 * MCP 工具授权（企业模式）。
 *
 * 背景：MCP REST 端点与 MCP 协议端点此前只要求登录，工具参数里的 projectId
 * 未做归属校验；literature.search 甚至没有 projectId 参数，会检索全库。
 * 本测试直接驱动 McpService.call，锁定「跨项目 404、缺 projectId 拒绝、
 * 全局配置仅 admin」三条语义，避免回退。
 */
const OLD_AUTH_MODE = process.env.AUTH_MODE;
const alice = { sub: 'mcp-alice', email: 'alice@test.local', role: 'user' };
const bob = { sub: 'mcp-bob', email: 'bob@test.local', role: 'user' };
const boss = { sub: 'mcp-boss', email: 'boss@test.local', role: 'admin' };

function makeService() {
  const access = new ProjectAccessService();
  const references = { search: (q: string, limit: number, projectId?: string) => ({ q, limit, projectId }) };
  const knowledge = { query: (projectId: string, question: string) => ({ projectId, question, answer: 'ok' }) };
  const config = { snapshot: () => ({ ok: true }) };
  return new McpService(
    {} as never,
    references as never,
    knowledge as never,
    config as never,
    {} as never,
    access,
  );
}

describe('McpService 工具授权（企业模式）', () => {
  let pidA: string;
  let pidB: string;

  beforeEach(() => {
    process.env.AUTH_MODE = 'jwt';
    const now = Date.now();
    pidA = randomUUID();
    pidB = randomUUID();
    db.insert(projects).values({ id: pidA, name: 'MCP Alice 项目', description: '', ownerId: alice.sub, createdAt: now, updatedAt: now }).run();
    db.insert(projects).values({ id: pidB, name: 'MCP Bob 项目', description: '', ownerId: bob.sub, createdAt: now, updatedAt: now }).run();
  });

  afterEach(() => {
    if (OLD_AUTH_MODE === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = OLD_AUTH_MODE;
  });

  it('knowledge.query：跨项目 404，owner 放行', async () => {
    const svc = makeService();
    await expect(svc.call('knowledge.query', { projectId: pidB, question: 'x' }, alice)).rejects.toThrow(NotFoundException);
    const r = await svc.call('knowledge.query', { projectId: pidA, question: 'x' }, alice);
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('ok');
  });

  it('literature.search：企业模式缺少 projectId 拒绝；跨项目 404；owner 放行', async () => {
    const svc = makeService();
    await expect(svc.call('literature.search', { query: 'x' }, alice)).rejects.toThrow(/projectId/);
    await expect(svc.call('literature.search', { query: 'x', projectId: pidB }, alice)).rejects.toThrow(NotFoundException);
    const r = await svc.call('literature.search', { query: 'x', projectId: pidA }, alice);
    expect(r.content[0].text).toContain(pidA);
  });

  it('config.*：企业模式仅 admin；admin 放行', async () => {
    const svc = makeService();
    await expect(svc.call('config.snapshot', {}, alice)).rejects.toThrow(/仅管理员/);
    const r = await svc.call('config.snapshot', {}, boss);
    expect(r.content[0].text).toContain('ok');
  });

  it('本地模式（AUTH_MODE=none）：不做项目限制，保持零登录体验', async () => {
    process.env.AUTH_MODE = 'none';
    const svc = makeService();
    const r = await svc.call('literature.search', { query: 'x' }, undefined);
    expect(r.content[0].text).toContain('x');
  });
});
