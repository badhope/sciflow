import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { citations, documents, references } from '../db/schema';
import { readProjectQualityStandard } from '../common/project-quality-standard';
import { assessSubmissionReadiness, resolveReadinessStandard, type SubmissionReadinessResult } from './submission-readiness';

@Injectable()
export class SubmissionReadinessService {
  /**
   * 投稿就绪检查：文档归属 → 项目文献库 / citation 表计数 → 确定性评估。
   * 只读、不落库；同一输入同一结论，适合投稿前反复刷新。
   */
  check(projectId: string, documentId: string): SubmissionReadinessResult & {
    projectId: string;
    documentId: string;
    title: string;
    documentStatus: string;
    updatedAt: number;
    checkedAt: number;
  } {
    if (!projectId?.trim()) throw new BadRequestException('projectId 必填');
    if (!documentId?.trim()) throw new BadRequestException('documentId 必填');

    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get();
    if (!doc || doc.projectId !== projectId) {
      throw new NotFoundException('文档不存在或不属于该项目');
    }

    const libraryReferences = db
      .select({ id: references.id })
      .from(references)
      .where(eq(references.projectId, projectId))
      .all().length;
    const citationLinks = db
      .select({ id: citations.id })
      .from(citations)
      .where(eq(citations.documentId, documentId))
      .all().length;

    const configuredStandard = readProjectQualityStandard(projectId);
    const result = assessSubmissionReadiness({
      title: doc.title || '',
      content: doc.content || '',
      libraryReferences,
      citationLinks,
      standard: resolveReadinessStandard(configuredStandard),
    });

    return {
      projectId,
      documentId,
      title: doc.title || '',
      documentStatus: doc.status || 'draft',
      updatedAt: doc.updatedAt,
      checkedAt: Date.now(),
      ...result,
    };
  }
}
