import { describe, expect, it } from 'vitest';
import { findLocalModel, LOCAL_MODELS } from './local-models.catalog';

describe('local model catalog', () => {
  it('keeps every recommended model under 2B, with long context and a pinned artifact', () => {
    expect(LOCAL_MODELS.length).toBeGreaterThan(0);
    for (const model of LOCAL_MODELS) {
      expect(model.params.endsWith('B')).toBe(true);
      expect(Number(model.params.slice(0, -1))).toBeLessThan(2);
      expect(model.contextWindow).toBeGreaterThanOrEqual(32 * 1024);
      expect(model.runtimeContextWindow).toBeGreaterThanOrEqual(8 * 1024);
      expect(model.runtimeContextWindow).toBeLessThanOrEqual(model.contextWindow);
      expect(model.sizeBytes).toBeGreaterThan(0);
      expect(model.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(model.fileName.endsWith('.gguf')).toBe(true);
      expect(model.sources.length).toBeGreaterThan(0);
      expect(model.ollamaName).toMatch(/^[a-z0-9._-]+$/);
    }
  });

  it('has unique ids and resolves by exact id only', () => {
    const ids = LOCAL_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findLocalModel('minicpm5-1b')?.name).toBe('MiniCPM5-1B');
    expect(findLocalModel('../etc/passwd')).toBeUndefined();
    expect(findLocalModel('')).toBeUndefined();
  });
});
