import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { projects, researchBriefs } from '../db/schema';
import { ResearchBriefService } from './research-brief.service';

const PID = 'brief-spec-project';
const NOW = Date.now();

describe('ResearchBriefService', () => {
  const svc = new ResearchBriefService();

  beforeEach(() => {
    db.delete(researchBriefs).where(eq(researchBriefs.projectId, PID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
    db.insert(projects).values({
      id: PID,
      name: '研究 Brief 测试项目',
      description: '',
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    }).run();
  });

  afterEach(() => {
    db.delete(researchBriefs).where(eq(researchBriefs.projectId, PID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
  });

  it('空 Brief 返回稳定默认值，而不是 null', () => {
    const brief = svc.get(PID);
    expect(brief.projectId).toBe(PID);
    expect(brief.question).toBe('');
    expect(brief.updatedAt).toBe(0);
  });

  it('首次写入并渲染为紧凑提示块', () => {
    const saved = svc.upsert(PID, {
      question: '图神经网络在低资源文本分类上是否优于微调？',
      scope: '只做中文短文本，不碰多模态',
      constraints: '单卡 24G，两周内完成',
    });
    expect(saved.question).toContain('图神经网络');
    expect(saved.scope).toContain('中文短文本');
    expect(saved.updatedAt).toBeGreaterThan(0);

    const rendered = svc.render(PID);
    expect(rendered).toContain('研究问题');
    expect(rendered).toContain('范围与边界');
    expect(rendered).toContain('约束');
    expect(rendered).not.toContain('成功标准');
  });

  it('局部更新合并旧字段，不会把未提交字段清空', () => {
    svc.upsert(PID, { question: '初始问题', scope: '初始范围' });
    const updated = svc.upsert(PID, { methods: '对照实验 + 消融' });
    expect(updated.question).toBe('初始问题');
    expect(updated.scope).toBe('初始范围');
    expect(updated.methods).toBe('对照实验 + 消融');
  });

  it('拒绝超长字段，避免把 prompt 撑爆', () => {
    expect(() => svc.upsert(PID, { question: 'x'.repeat(3001) })).toThrow(/格式不正确/);
  });
});
