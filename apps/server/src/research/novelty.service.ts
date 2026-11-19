import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { references } from '../db/schema';
import { noveltyOverlap } from '../pipeline/pipeline-metrics';
import { noveltyFallback, specificityOf } from '../pipeline/novelty-fallback';
import { ScholarHit, ScholarSearchService, ScholarSourceStatus, summarizeScholarSources } from './scholar-search.service';

export type NoveltyStatus = 'ok' | 'degraded' | 'offline' | 'disabled';

export interface NoveltySimilarWork {
  title: string;
  year: number | null;
  venue: string;
  doi: string;
  url: string;
  source: string;
  citationCount: number;
}

export interface NoveltyCheckResult {
  /** 联网查新是否真正完成：ok 正常 / degraded 部分源不可达 / offline 全源不可达 / disabled 功能关闭 */
  status: NoveltyStatus;
  enabled: boolean;
  /** 兼容流水线旧字段：全源不可达时为 true，图谱据此展示“离线降级” */
  offline: boolean;
  basis: 'scholar' | 'offline-fallback';
  overlap: number;
  specificity: number;
  similar: NoveltySimilarWork[];
  advice: string;
  /** 给用户的可行动提示；正常查新时为空串 */
  notice: string;
  sources: ScholarSourceStatus[];
  hitCount: number;
}

function toSimilar(hit: ScholarHit): NoveltySimilarWork {
  return {
    title: hit.title,
    year: hit.year,
    venue: hit.venue,
    doi: hit.doi,
    url: hit.url,
    source: hit.source,
    citationCount: hit.citationCount,
  };
}

/**
 * 选题查新服务（选题 → 投稿闭环的起点）。
 *
 * 流水线内原先有一份私有 noveltyCheck；抽出来后研究设计页可以在立项前单独查新，
 * 两条路径共用同一套重叠度口径、三源可达性状态与离线降级文案，避免 UI 与流水线各说各话。
 */
@Injectable()
export class NoveltyService {
  constructor(private readonly scholar: ScholarSearchService) {}

  async check(topic: string, projectId?: string, searchQuery?: string): Promise<NoveltyCheckResult> {
    const text = (topic || '').trim();
    const localTitles = this.localTitles(projectId);
    const specificity = specificityOf(text);

    if (!this.scholar.isEnabledNow()) {
      const fb = noveltyFallback({ topic: text, localTitles });
      return {
        status: 'disabled',
        enabled: false,
        offline: true,
        basis: 'offline-fallback',
        overlap: fb.overlap,
        specificity,
        similar: [],
        advice: fb.advice,
        notice: '学术检索已关闭（SCHOLAR_SEARCH=off），已用本地文献库做降级判断；需要联网查新时请在系统设置中开启。',
        sources: [],
        hitCount: 0,
      };
    }

    let outcome: Awaited<ReturnType<ScholarSearchService['searchWithStatus']>>;
    try {
      // 中文选题可由前端额外传英文检索词；没有就退回选题原文
      outcome = await this.scholar.searchWithStatus([(searchQuery || text).trim()], 8);
    } catch {
      const fb = noveltyFallback({ topic: text, localTitles });
      return {
        status: 'offline',
        enabled: true,
        offline: true,
        basis: 'offline-fallback',
        overlap: fb.overlap,
        specificity,
        similar: [],
        advice: fb.advice,
        notice: '学术检索请求异常，已用本地文献库做降级判断；可稍后重试或配置代理。',
        sources: [],
        hitCount: 0,
      };
    }

    const state = summarizeScholarSources(outcome.sources, outcome.hits.length);
    if (state.status === 'offline') {
      const fb = noveltyFallback({ topic: text, localTitles });
      return {
        status: 'offline',
        enabled: true,
        offline: true,
        basis: 'offline-fallback',
        overlap: fb.overlap,
        specificity,
        similar: [],
        advice: fb.advice,
        notice: state.notice,
        sources: outcome.sources,
        hitCount: 0,
      };
    }

    const partialNotice = state.status === 'degraded' ? state.notice : '';
    const hits = outcome.hits;
    if (!hits.length) {
      return {
        status: state.status,
        enabled: true,
        offline: false,
        basis: 'scholar',
        overlap: 0,
        specificity,
        similar: [],
        advice: partialNotice
          ? '部分学术源不可达，当前命中为空不能据此判断选题新颖；请配置代理后复核，或先用本地库做降级判断'
          : '学术库未找到相近工作，选题可能较新；建议再用 1-2 组同义词复核',
        notice: partialNotice,
        sources: outcome.sources,
        hitCount: 0,
      };
    }

    const recent = hits.filter((h) => !h.year || h.year >= new Date().getFullYear() - 8);
    const pool = recent.length ? recent : hits;
    // 中文选题常配英文检索词；重叠度取「选题原文」与「检索词」二者较高值，避免中文 token 对比英文标题恒为 0
    const overlap = Math.max(
      noveltyOverlap(text, pool.map((h) => h.title)),
      noveltyOverlap((searchQuery || text).trim(), pool.map((h) => h.title)),
    );
    const similar = pool.slice(0, 5).map(toSimilar);
    const advice =
      overlap >= 70
        ? '重叠度高：建议把研究问题收窄到具体子问题/新数据集/新评估协议，或在大纲里显式对比这几篇并说明增量'
        : overlap >= 40
          ? '重叠度中等：选题方向已有人做，需在引言明确差异化定位（方法/数据/场景/评价维度至少一项不同）'
          : '重叠度低：相近工作较少，注意确认是"真空白"还是"检索词未覆盖"';
    return {
      status: state.status,
      enabled: true,
      offline: false,
      basis: 'scholar',
      overlap,
      specificity,
      similar,
      advice,
      notice: partialNotice,
      sources: outcome.sources,
      hitCount: hits.length,
    };
  }

  /** 离线降级用的本地标题池；必须按项目过滤，避免跨项目文献污染新颖性判断。 */
  private localTitles(projectId?: string): string[] {
    try {
      const rows = projectId
        ? db.select({ title: references.title }).from(references).where(eq(references.projectId, projectId)).all()
        : db.select({ title: references.title }).from(references).all();
      return rows.map((r) => r.title || '').filter(Boolean);
    } catch {
      return [];
    }
  }
}
