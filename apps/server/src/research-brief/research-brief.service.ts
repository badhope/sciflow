import { BadRequestException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/database';
import { researchBriefs } from '../db/schema';
import type { ResearchBriefDto } from './research-brief.dto';

export type { ResearchBriefDto };

const patchSchema = z.object({
  question: z.string().max(3000).optional(),
  scope: z.string().max(3000).optional(),
  methods: z.string().max(3000).optional(),
  constraints: z.string().max(3000).optional(),
  successCriteria: z.string().max(3000).optional(),
});

/**
 * 项目级研究 Brief。
 *
 * 它不是又一份“项目描述”，而是 Agent 每轮都要读的研究契约：
 * 研究问题、边界、方法约束、成功标准。写入结构化字段，渲染成紧凑提示块，
 * 供聊天上下文与 research.plan 注入；避免把长文项目说明塞进 prompt。
 */
@Injectable()
export class ResearchBriefService {
  get(projectId: string): ResearchBriefDto {
    if (!projectId) throw new BadRequestException('projectId 不能为空');
    const row = db.select().from(researchBriefs).where(eq(researchBriefs.projectId, projectId)).get();
    if (!row) {
      return {
        projectId,
        question: '',
        scope: '',
        methods: '',
        constraints: '',
        successCriteria: '',
        updatedAt: 0,
      };
    }
    return {
      projectId: row.projectId,
      question: row.question ?? '',
      scope: row.scope ?? '',
      methods: row.methods ?? '',
      constraints: row.constraints ?? '',
      successCriteria: row.successCriteria ?? '',
      updatedAt: row.updatedAt,
    };
  }

  upsert(projectId: string, patch: unknown): ResearchBriefDto {
    if (!projectId) throw new BadRequestException('projectId 不能为空');
    const parsed = patchSchema.safeParse(patch);
    if (!parsed.success) throw new BadRequestException('Research Brief 字段格式不正确');
    const data = parsed.data;
    const now = Date.now();
    const previous = this.get(projectId);
    const next = {
      question: data.question ?? previous.question,
      scope: data.scope ?? previous.scope,
      methods: data.methods ?? previous.methods,
      constraints: data.constraints ?? previous.constraints,
      successCriteria: data.successCriteria ?? previous.successCriteria,
      updatedAt: now,
    };
    db.insert(researchBriefs)
      .values({ projectId, ...next })
      .onConflictDoUpdate({ target: researchBriefs.projectId, set: next })
      .run();
    return this.get(projectId);
  }

  /**
   * 渲染进 prompt 的紧凑块。只保留有内容的字段，并对单字段截断；
   * 总长上限 2400 字符，避免 Brief 变成第二个“项目全文”。
   */
  render(projectId: string): string {
    const brief = this.get(projectId);
    const values = [brief.question, brief.scope, brief.methods, brief.constraints, brief.successCriteria];
    if (!values.some((value) => value.trim())) return '';
    const lines: string[] = ['项目研究 Brief（Agent 必须遵守的上下文）：'];
    const add = (label: string, value: string) => {
      const text = value.trim();
      if (text) lines.push(`${label}：${text.slice(0, 600)}`);
    };
    add('研究问题', brief.question);
    add('范围与边界', brief.scope);
    add('方法与数据', brief.methods);
    add('约束', brief.constraints);
    add('成功标准', brief.successCriteria);
    return lines.join('\n').slice(0, 2400);
  }
}
