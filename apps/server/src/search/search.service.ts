import { Injectable } from '@nestjs/common';
import { and, eq, like, or } from 'drizzle-orm';
import { db } from '../db/database';
import {
  chatSessions,
  documents,
  experiments,
  knowledgeChunks,
  knowledgeDocs,
  projects,
  references,
} from '../db/schema';

export type SearchType = 'document' | 'chat' | 'project' | 'experiment' | 'reference' | 'knowledge';

export const SEARCH_TYPES: SearchType[] = ['document', 'chat', 'project', 'experiment', 'reference', 'knowledge'];

export interface SearchHit {
  type: SearchType;
  id: string;
  title: string;
  snippet: string;
  score: number;
  route: string;
  updatedAt?: number;
}

/** 生成命中片段：优先围绕关键词，其次取正文开头；统一压平换行，避免面板里多行抖动。 */
export function buildSnippet(text: string, query: string, radius = 72): string {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const lower = flat.toLowerCase();
  const q = query.trim().toLowerCase();
  const at = q ? lower.indexOf(q) : -1;
  if (at < 0) return flat.slice(0, radius * 2) + (flat.length > radius * 2 ? '…' : '');
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + q.length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

export function scoreHit(title: string, body: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = (title || '').toLowerCase();
  const b = (body || '').toLowerCase();
  let score = 0;
  if (t === q) score += 120;
  else if (t.includes(q)) score += 80;
  if (b.includes(q)) {
    const count = b.split(q).length - 1;
    score += 30 + Math.min(30, count * 2);
  }
  return score;
}

function parseTypes(raw?: string): SearchType[] {
  const requested = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!requested.length) return SEARCH_TYPES;
  const allowed = requested.filter((t): t is SearchType => (SEARCH_TYPES as string[]).includes(t));
  return allowed.length ? allowed : SEARCH_TYPES;
}

@Injectable()
export class SearchService {
  search(projectId: string, query: string, typesRaw?: string): SearchHit[] {
    const q = String(query || '').trim();
    if (!q) return [];
    const types = parseTypes(typesRaw);
    const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const hits: SearchHit[] = [];
    const push = (hit: SearchHit) => {
      if (hit.score > 0 && hit.title) hits.push(hit);
    };

    if (types.includes('document')) {
      const rows = db.select().from(documents)
        .where(and(eq(documents.projectId, projectId), or(like(documents.title, pattern), like(documents.content, pattern))))
        .limit(20).all();
      for (const row of rows) {
        push({
          type: 'document', id: row.id, title: row.title,
          snippet: buildSnippet(row.content || '', q),
          score: scoreHit(row.title, row.content || '', q),
          route: `/writing?doc=${encodeURIComponent(row.id)}`,
          updatedAt: row.updatedAt,
        });
      }
    }

    if (types.includes('chat')) {
      const rows = db.select().from(chatSessions)
        .where(and(
          eq(chatSessions.projectId, projectId),
          eq(chatSessions.summaryOnly, 0),
          or(like(chatSessions.title, pattern), like(chatSessions.messagesJson, pattern), like(chatSessions.summary, pattern)),
        ))
        .limit(20).all();
      for (const row of rows) {
        const body = `${row.summary || ''}\n${row.messagesJson || ''}`;
        push({
          type: 'chat', id: row.id, title: row.title || '未命名会话',
          snippet: buildSnippet(body, q),
          score: scoreHit(row.title || '', body, q),
          route: `/workspace?session=${encodeURIComponent(row.id)}`,
          updatedAt: row.lastMessageAt || row.updatedAt,
        });
      }
    }

    if (types.includes('project')) {
      const rows = db.select().from(projects)
        .where(and(eq(projects.id, projectId), or(like(projects.name, pattern), like(projects.description, pattern))))
        .limit(5).all();
      for (const row of rows) {
        push({
          type: 'project', id: row.id, title: row.name,
          snippet: buildSnippet(row.description || '', q),
          score: scoreHit(row.name, row.description || '', q),
          route: `/dashboard?project=${encodeURIComponent(row.id)}`,
          updatedAt: row.updatedAt,
        });
      }
    }

    if (types.includes('experiment')) {
      const rows = db.select().from(experiments)
        .where(and(
          eq(experiments.projectId, projectId),
          or(like(experiments.goal, pattern), like(experiments.conclusion, pattern), like(experiments.stdout, pattern), like(experiments.stderr, pattern)),
        ))
        .limit(20).all();
      for (const row of rows) {
        const body = `${row.goal || ''}\n${row.conclusion || ''}\n${row.stdout || ''}\n${row.stderr || ''}`;
        push({
          type: 'experiment', id: row.id,
          title: (row.goal || `实验 ${row.id.slice(0, 8)}`).slice(0, 80),
          snippet: buildSnippet(body, q),
          score: scoreHit(row.goal || '', body, q),
          route: `/experiments?focus=${encodeURIComponent(row.id)}`,
          updatedAt: row.updatedAt,
        });
      }
    }

    if (types.includes('reference')) {
      const rows = db.select().from(references)
        .where(and(
          eq(references.projectId, projectId),
          or(like(references.title, pattern), like(references.abstract, pattern), like(references.notes, pattern), like(references.venue, pattern)),
        ))
        .limit(20).all();
      for (const row of rows) {
        const body = `${row.abstract || ''}\n${row.notes || ''}\n${row.venue || ''}`;
        push({
          type: 'reference', id: row.id, title: row.title,
          snippet: buildSnippet(body, q),
          score: scoreHit(row.title, body, q),
          route: `/literature?focus=${encodeURIComponent(row.id)}`,
          updatedAt: row.createdAt,
        });
      }
    }

    if (types.includes('knowledge')) {
      const rows = db.select({
        docId: knowledgeDocs.id,
        name: knowledgeDocs.name,
        chunk: knowledgeChunks.content,
        seq: knowledgeChunks.seq,
        createdAt: knowledgeDocs.createdAt,
      }).from(knowledgeChunks)
        .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
        .where(and(
          eq(knowledgeDocs.projectId, projectId),
          or(like(knowledgeDocs.name, pattern), like(knowledgeChunks.content, pattern)),
        ))
        .limit(60).all();
      const byDoc = new Map<string, SearchHit & { count: number }>();
      for (const row of rows) {
        const score = scoreHit(row.name, row.chunk || '', q) + (row.seq === 0 ? 2 : 0);
        const prev = byDoc.get(row.docId);
        if (prev) {
          prev.count += 1;
          prev.score = Math.max(prev.score, score);
          if (score > prev.score) prev.snippet = `${buildSnippet(row.chunk || '', q)} · ${prev.count} 处命中`;
        } else {
          byDoc.set(row.docId, {
            type: 'knowledge', id: row.docId, title: row.name,
            snippet: buildSnippet(row.chunk || '', q),
            score, route: `/knowledge?doc=${encodeURIComponent(row.docId)}&q=${encodeURIComponent(q)}`,
            updatedAt: row.createdAt, count: 1,
          });
        }
      }
      for (const hit of byDoc.values()) {
        const { count: _count, ...clean } = hit;
        push(clean);
      }
    }

    return hits.sort((a, b) => b.score - a.score || (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 60);
  }
}
