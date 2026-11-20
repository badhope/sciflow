import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/database';
import { citations, documents, references } from '../db/schema';
import { parseJson } from '../common/json-guard';
import { SubmissionReadinessService } from './submission-readiness.service';
import { buildSubmissionPackage, type SubmissionPackageFile } from './submission-package';

const EMPTY_OUTLINE: { title: string; sections: { title: string; subsections: string[] }[] } = { title: '', sections: [] };

export interface SubmissionPackageResponse {
  projectId: string;
  documentId: string;
  title: string;
  generatedAt: string;
  filename: string;
  base64: string;
  size: number;
  files: SubmissionPackageFile[];
  ready: boolean;
  score: number;
  failCount: number;
  warnCount: number;
}

@Injectable()
export class SubmissionPackageService {
  constructor(private readonly readiness: SubmissionReadinessService) {}

  /**
   * 投稿包：readiness + 现有 DOCX / BibTeX 导出 → ZIP。
   * 只读、不调模型；阻塞态也允许导出，但清单会保留阻塞项。
   */
  async build(projectId: string, documentId: string): Promise<SubmissionPackageResponse> {
    const readiness = this.readiness.check(projectId, documentId);
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get();
    if (!doc || doc.projectId !== projectId) throw new NotFoundException('文档不存在或不属于该项目');
    // readiness.check 已做归属校验；这里再取正文/大纲用于导出。
    const outline = parseJson<{ title: string; sections: { title: string; subsections: string[] }[] }>(doc.outline, EMPTY_OUTLINE);

    const projectRefs = db
      .select({
        id: references.id,
        title: references.title,
        authors: references.authors,
        year: references.year,
        venue: references.venue,
        doi: references.doi,
      })
      .from(references)
      .where(eq(references.projectId, projectId))
      .orderBy(asc(references.createdAt), asc(references.id))
      .all();

    const citationRows = db
      .select({ reference: references })
      .from(citations)
      .innerJoin(references, eq(citations.referenceId, references.id))
      .where(eq(citations.documentId, documentId))
      .orderBy(asc(citations.createdAt), asc(citations.id))
      .all();
    const citationRefs = citationRows.map((r) => ({
      title: r.reference.title,
      authors: r.reference.authors,
      year: r.reference.year,
      venue: r.reference.venue,
      doi: r.reference.doi,
    }));

    const generatedAt = new Date();
    const pkg = await buildSubmissionPackage({
      projectId,
      documentId,
      title: doc.title || '',
      outline,
      content: doc.content || '',
      projectRefs,
      citationRefs,
      readiness,
      generatedAt,
    });

    return {
      projectId,
      documentId,
      title: doc.title || '',
      generatedAt: generatedAt.toISOString(),
      filename: pkg.filename,
      base64: pkg.base64,
      size: pkg.size,
      files: pkg.files,
      ready: readiness.ready,
      score: readiness.score,
      failCount: readiness.failCount,
      warnCount: readiness.warnCount,
    };
  }
}
