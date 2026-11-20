import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/database';
import { citations, documents, experiments, projects, references } from '../db/schema';
import { parseJson } from '../common/json-guard';
import { SubmissionReadinessService } from './submission-readiness.service';
import { buildSubmissionPackage, type SubmissionPackageFigure, type SubmissionPackageFile } from './submission-package';

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
  journal: string;
  template: { key: string; label: string; note: string };
  figures: { name: string; caption: string; bytes: number }[];
}

export interface SubmissionPackageOptions {
  journal?: string;
  template?: string;
}

@Injectable()
export class SubmissionPackageService {
  constructor(private readonly readiness: SubmissionReadinessService) {}

  /**
   * 投稿包：readiness + 现有 DOCX / BibTeX 导出 → ZIP。
   * 只读、不调模型；阻塞态也允许导出，但清单会保留阻塞项。
   */
  async build(projectId: string, documentId: string, options: SubmissionPackageOptions = {}): Promise<SubmissionPackageResponse> {
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

    const projectName = db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).get()?.name || '';
    const figures = this.collectFigures(projectId);
    const generatedAt = new Date();
    const pkg = await buildSubmissionPackage({
      projectId,
      documentId,
      title: doc.title || '',
      projectName,
      outline,
      content: doc.content || '',
      projectRefs,
      citationRefs,
      readiness,
      figures,
      journal: options.journal,
      template: options.template,
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
      journal: pkg.journal,
      template: pkg.template,
      figures: pkg.figures,
    };
  }

  /**
   * 收集项目实验产出的 PNG 图表：只取 data:image/png;base64 的 data URL。
   * 单张 >2MB 或总量 >8MB 直接跳过，避免投稿包被截图撑爆；跳过项不写入 manifest。
   */
  private collectFigures(projectId: string): SubmissionPackageFigure[] {
    const rows = db
      .select({ id: experiments.id, goal: experiments.goal, conclusion: experiments.conclusion, figures: experiments.figures, createdAt: experiments.createdAt })
      .from(experiments)
      .where(eq(experiments.projectId, projectId))
      .orderBy(asc(experiments.createdAt))
      .all();
    const out: SubmissionPackageFigure[] = [];
    let total = 0;
    for (const row of rows) {
      const urls = parseJson<string[]>(row.figures, []);
      for (const url of urls) {
        if (out.length >= 8 || total >= 8 * 1024 * 1024) return out;
        const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(url || '').trim());
        if (!m) continue;
        const data = Buffer.from(m[1], 'base64');
        if (!data.length || data.length > 2 * 1024 * 1024) continue;
        const caption = String(row.conclusion || '').trim() || String(row.goal || '').trim() || `实验图表 ${row.id.slice(0, 8)}`;
        out.push({
          name: `figures/figure-${String(out.length + 1).padStart(2, '0')}.png`,
          caption: caption.slice(0, 200),
          bytes: data.length,
          data,
        });
        total += data.length;
      }
    }
    return out;
  }
}
