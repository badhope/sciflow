import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { appSettings, projects } from '../db/schema';
import { ProjectsService } from './projects.service';
import { readProjectQualityStandard } from '../common/project-quality-standard';

const PID = 'test-quality-standard-proj';

function cleanup() {
  db.delete(appSettings).where(eq(appSettings.key, `quality_standard:project:${PID}`)).run();
  db.delete(projects).where(eq(projects.id, PID)).run();
}

describe('项目级评审标准', () => {
  beforeEach(() => {
    cleanup();
    const now = Date.now();
    db.insert(projects).values({ id: PID, name: '标准测试项目', description: '', status: 'active', createdAt: now, updatedAt: now }).run();
    db.delete(appSettings).where(eq(appSettings.key, 'quality_standard')).run();
  });
  afterEach(cleanup);

  it('未设置时回退全局，来源标记为 global', () => {
    db.insert(appSettings).values({ key: 'quality_standard', value: 'review' }).run();
    const svc = new ProjectsService();
    const got = svc.getQualityStandard(PID);
    expect(got.key).toBe('review');
    expect(got.source).toBe('global');
  });

  it('项目级设置优先，清除后回退全局', () => {
    db.insert(appSettings).values({ key: 'quality_standard', value: 'review' }).run();
    const svc = new ProjectsService();
    expect(svc.setQualityStandard(PID, 'strict').key).toBe('strict');
    expect(svc.getQualityStandard(PID).source).toBe('project');
    expect(readProjectQualityStandard(PID)).toBe('strict');
    expect(svc.clearQualityStandard(PID).key).toBe('review');
    expect(svc.getQualityStandard(PID).source).toBe('global');
  });

  it('非法标准拒绝写入，不污染项目设置', () => {
    const svc = new ProjectsService();
    expect(() => svc.setQualityStandard(PID, 'top-secret')).toThrow(/未知评审标准/);
    expect(svc.getQualityStandard(PID).source).toBe('fallback');
    expect(svc.getQualityStandard(PID).key).toBe('standard');
  });
});
