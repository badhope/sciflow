import { describe, expect, it } from 'vitest';
import { CodeDiagnosticsService } from './code-diagnostics.service';

describe('CodeDiagnosticsService', () => {
  const service = new CodeDiagnosticsService();

  it('reports a TypeScript type error with line and column', () => {
    const result = service.diagnose('const answer: number = "not a number";\nconsole.log(answer);');
    expect(result.ok).toBe(false);
    expect(result.errors).toBeGreaterThan(0);
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({ line: 1, category: 'error', code: expect.any(Number) }),
    );
    expect(result.diagnostics[0].message).toContain('number');
  });

  it('accepts well-typed TypeScript', () => {
    const result = service.diagnose('const answer: number = 42;\nexport const doubled = answer * 2;');
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);
  });

  it('checks JavaScript syntax without executing it', () => {
    const result = service.diagnose('const x = ;', 'javascript', 'input.js');
    expect(result.ok).toBe(false);
    expect(result.language).toBe('javascript');
  });

  it('rejects empty and oversized input', () => {
    expect(() => service.diagnose('')).toThrow(/不能为空/);
    expect(() => service.diagnose('x'.repeat(100_001))).toThrow(/100000/);
  });
});
