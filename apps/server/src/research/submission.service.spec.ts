import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/database';
import { projects, submissions, submissionStatusEvents } from '../db/schema';
import { SubmissionService } from './submission.service';

const PID = 'sub-spec-project';
const NOW = Date.now();

/** createTrack / listTracks 是 Agent 投稿写入口的底座，必须有数据库级回归。 */
describe('SubmissionService tracking', () => {
  const svc = new SubmissionService({} as any);

  const clearProjectSubmissions = () => {
    const ids = db.select({ id: submissions.id }).from(submissions).where(eq(submissions.projectId, PID)).all().map((r) => r.id);
    if (ids.length) db.delete(submissionStatusEvents).where(inArray(submissionStatusEvents.submissionId, ids)).run();
    db.delete(submissions).where(eq(submissions.projectId, PID)).run();
  };

  beforeEach(() => {
    clearProjectSubmissions();
    db.delete(projects).where(eq(projects.id, PID)).run();
    db.insert(projects).values({ id: PID, name: '投稿测试项目', description: '', status: 'active', createdAt: NOW, updatedAt: NOW }).run();
  });

  afterEach(() => {
    clearProjectSubmissions();
    db.delete(projects).where(eq(projects.id, PID)).run();
  });

  it('拒绝缺少项目或期刊名的登记', () => {
    expect(() => svc.createTrack({ projectId: '', journalName: '计算机学报' })).toThrow(/projectId/);
    expect(() => svc.createTrack({ projectId: PID, journalName: '  ' })).toThrow(/期刊名/);
  });

  it('拒绝未知投稿状态', () => {
    expect(() => svc.createTrack({ projectId: PID, journalName: '计算机学报', currentStatus: 'fake_status' })).toThrow(/未知投稿状态/);
  });

  it('登记后写入首条状态事件，列表带事件与推断字段', () => {
    const created = svc.createTrack({
      projectId: PID,
      journalName: '计算机学报',
      title: '图神经网络综述',
      submittedAt: NOW - 1000,
      currentStatus: 'submitted',
      note: '首投',
    });
    expect(created.journalName).toBe('计算机学报');
    expect(created.title).toBe('图神经网络综述');
    expect(created.events).toHaveLength(1);
    expect(created.events[0].toStatus).toBe('submitted');

    const list = svc.listTracks(PID);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
    expect(list[0].events).toHaveLength(1);
    expect(list[0]).toHaveProperty('overdue');
    expect(list[0]).toHaveProperty('estimatedStage');
  });

  it('列表为空时返回空数组，不抛错', () => {
    expect(svc.listTracks(PID)).toEqual([]);
  });
});
