import { beforeEach, describe, expect, it } from 'vitest';
import { TaskListService } from './task-list.service';
import { db } from '../db/database';
import { agentTasks } from '../db/schema';

/**
 * 任务清单的行为回归。
 *
 * 价值在于「模型自述进度」必须可核：清单要能整体替换、要能保留既有 id
 * （前端动画连续）、进度百分比要算对、清空不能误伤别的项目。
 */

const svc = new TaskListService();
const PROJECT = 'test-tasklist-project';
const OTHER = 'test-tasklist-other';

beforeEach(() => {
  db.delete(agentTasks).run();
});

describe('TaskListService', () => {
  it('整体替换清单并保持顺序', () => {
    const tasks = svc.replaceAll(
      [{ content: '第一步', priority: 'high' }, { content: '第二步' }, { content: '第三步', priority: 'low' }],
      PROJECT,
    );
    expect(tasks.map((t) => t.content)).toEqual(['第一步', '第二步', '第三步']);
    expect(tasks[0].priority).toBe('high');
    expect(tasks[2].priority).toBe('low');
  });

  it('重复内容保留原 id，前端动画不重绘', () => {
    const first = svc.replaceAll([{ content: '不变项' }], PROJECT);
    const second = svc.replaceAll([{ content: '不变项' }, { content: '新增项' }], PROJECT);
    expect(second[0].id).toBe(first[0].id);
  });

  it('删除的条目不会残留', () => {
    svc.replaceAll([{ content: 'A' }, { content: 'B' }], PROJECT);
    const after = svc.replaceAll([{ content: 'A' }], PROJECT);
    expect(after).toHaveLength(1);
    expect(after[0].content).toBe('A');
  });

  it('进度摘要只统计有效状态', () => {
    svc.replaceAll(
      [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
        { content: 'd', status: 'cancelled' },
      ],
      PROJECT,
    );
    const s = svc.summary(PROJECT);
    expect(s.total).toBe(3); // cancelled 不计入
    expect(s.completed).toBe(1);
    expect(s.inProgress).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.percent).toBe(33);
  });

  it('单项状态推进', () => {
    const [t] = svc.replaceAll([{ content: '推进我' }], PROJECT);
    const updated = svc.setStatus(t.id, 'completed');
    expect(updated?.status).toBe('completed');
    expect(svc.summary(PROJECT).completed).toBe(1);
  });

  it('清空只影响指定项目', () => {
    svc.replaceAll([{ content: '本项目' }], PROJECT);
    svc.replaceAll([{ content: '别的项目' }], OTHER);
    svc.clear(PROJECT);
    expect(svc.list(PROJECT)).toHaveLength(0);
    expect(svc.list(OTHER)).toHaveLength(1);
  });

  it('非法状态与优先级回落到安全默认值', () => {
    const [t] = svc.replaceAll([{ content: 'x', status: 'bogus' as never, priority: 'nope' as never }], PROJECT);
    expect(t.status).toBe('pending');
    expect(t.priority).toBe('medium');
  });

  it('空内容被丢弃，超长内容被截断', () => {
    const tasks = svc.replaceAll([{ content: '   ' }, { content: 'y'.repeat(500) }], PROJECT);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].content.length).toBeLessThanOrEqual(301);
  });

  it('条目数量有上限，防止界面被塞满', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ content: `任务 ${i}` }));
    expect(svc.replaceAll(many, PROJECT)).toHaveLength(50);
  });
});
