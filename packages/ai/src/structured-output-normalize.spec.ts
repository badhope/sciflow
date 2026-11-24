import { describe, it, expect } from 'vitest';
import { normalizeStructuredObject } from './ai-transport.service';
import { z } from 'zod';

const expertSchema = z.object({
  approved: z.boolean(),
  confidence: z.number().int().min(0).max(100),
  rationale: z.string(),
  concerns: z.array(z.string()),
  requiredChanges: z.array(z.string()),
});

const schemaText = JSON.stringify(expertSchema.toJSONSchema());

describe('normalizeStructuredObject', () => {
  it('把真实模型的中文键与自然语言布尔值归一化为 schema 英文键', () => {
    const raw = {
      是否批准: '驳回',
      置信度: '35',
      理由: '协议把 sklearn 写进步骤，但沙箱只允许 numpy/pandas/scipy。',
      顾虑: '随机森林依赖不可用',
      修改要求: ['改为纯 numpy bagging'],
    };
    const normalized = normalizeStructuredObject(raw, schemaText) as Record<string, unknown>;
    expect(normalized.approved).toBe(false);
    expect(normalized.confidence).toBe(35);
    expect(normalized.rationale).toContain('sklearn');
    expect(normalized.concerns).toEqual(['随机森林依赖不可用']);
    expect(normalized.requiredChanges).toEqual(['改为纯 numpy bagging']);
    expect(expertSchema.safeParse(normalized).success).toBe(true);
  });

  it('「批准/通过/同意」归一化为 true', () => {
    const normalized = normalizeStructuredObject({ 是否批准: '通过' }, schemaText) as Record<string, unknown>;
    expect(normalized.approved).toBe(true);
  });

  it('嵌套对象不被顶层 schema 字段裁剪', () => {
    const raw = {
      approved: true,
      confidence: 90,
      rationale: 'ok',
      concerns: [],
      requiredChanges: [],
      reviewer: { 结论: '通过', score: 80 },
    };
    const normalized = normalizeStructuredObject(raw, '') as Record<string, unknown>;
    expect(normalized.reviewer).toEqual({ 结论: '通过', score: 80 });
  });

  it('顶层未知字段被丢弃，避免污染 schema', () => {
    const raw = { approved: true, confidence: 1, rationale: 'x', concerns: [], requiredChanges: [], 无关字段: 'x' };
    const normalized = normalizeStructuredObject(raw, schemaText) as Record<string, unknown>;
    expect(normalized.无关字段).toBeUndefined();
  });
});

describe('真实模型的英文同义键', () => {
  it('reasons/issues/required_changes 映射到 schema 键，数组理由合并为字符串', () => {
    const raw = {
      approved: true,
      confidence: 0.99,
      reasons: ['理论相关系数 σ=0.05 时约 0.99', '高噪声组约 0.28'],
      issues: '仍未写明随机种子',
      required_changes: ['补充 seed=42'],
    };
    const normalized = normalizeStructuredObject(raw, schemaText) as Record<string, unknown>;
    expect(normalized.rationale).toContain('0.28');
    expect(normalized.confidence).toBe(99);
    expect(normalized.concerns).toEqual(['仍未写明随机种子']);
    expect(normalized.requiredChanges).toEqual(['补充 seed=42']);
    expect(expertSchema.safeParse(normalized).success).toBe(true);
  });
});
