import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { appSettings } from '../db/schema';
import { parseQualityStandard, QUALITY_STANDARD_KEYS, type QualityStandardKey } from './quality-standards';

/** 项目级标准优先；未设置时回退全局 quality_standard；DB 异常 fail-closed 回 standard。 */
export function readProjectQualityStandard(projectId?: string | null): QualityStandardKey {
  try {
    if (projectId?.trim()) {
      const projectRow = db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, projectQualityKey(projectId)))
        .get();
      if (projectRow?.value) return parseQualityStandard(projectRow.value).key;
    }
    const globalRow = db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'quality_standard')).get();
    return parseQualityStandard(globalRow?.value).key;
  } catch {
    return 'standard';
  }
}

export function getProjectQualityStandard(projectId: string): {
  key: QualityStandardKey;
  label: string;
  passScore: number;
  minChars: number;
  minSections: number;
  minUniqueCitations: number;
  source: 'project' | 'global' | 'fallback';
} {
  const std = parseQualityStandard(readProjectQualityStandard(projectId));
  let source: 'project' | 'global' | 'fallback' = 'fallback';
  try {
    const projectRow = db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, projectQualityKey(projectId)))
      .get();
    if (projectRow?.value) source = 'project';
    else {
      const globalRow = db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'quality_standard')).get();
      source = globalRow?.value ? 'global' : 'fallback';
    }
  } catch {
    source = 'fallback';
  }
  return {
    key: std.key,
    label: std.label,
    passScore: std.passScore,
    minChars: std.minChars,
    minSections: std.minSections,
    minUniqueCitations: std.minUniqueCitations,
    source,
  };
}

export function setProjectQualityStandard(projectId: string, value: string): QualityStandardKey {
  const normalized = String(value ?? '').trim().toLowerCase() as QualityStandardKey;
  if (!QUALITY_STANDARD_KEYS.includes(normalized)) {
    throw new Error(`未知评审标准「${value}」，可选：${QUALITY_STANDARD_KEYS.join(' / ')}`);
  }
  db.insert(appSettings)
    .values({ key: projectQualityKey(projectId), value: normalized })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: normalized } })
    .run();
  return normalized;
}

export function clearProjectQualityStandard(projectId: string): void {
  db.delete(appSettings).where(eq(appSettings.key, projectQualityKey(projectId))).run();
}

function projectQualityKey(projectId: string): string {
  return `quality_standard:project:${projectId}`;
}
