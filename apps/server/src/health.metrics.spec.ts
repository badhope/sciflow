import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';

/**
 * Prometheus 暴露格式回归：监控系统按 text exposition format 0.0.4 解析，
 * 格式错一行整批指标都会丢。这里断言的是「可被 scrape」这个外部契约，
 * 不是某个内部实现细节。
 */
function makeController(): HealthController {
  const ai = { config: { configured: false, mock: true, model: 'stub', strongModel: 'stub', baseUrl: '' } } as never;
  const embedding = { status: () => ({ backend: 'none', dimension: 0 }) } as never;
  return new HealthController(ai, embedding);
}

describe('GET /api/metrics（Prometheus text format）', () => {
  const body = makeController().metrics();

  it('每个指标都有 HELP 与 TYPE 行', () => {
    const names = [...body.matchAll(/^# TYPE (sciflow_[a-z0-9_]+) /gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) {
      expect(body).toContain(`# HELP ${n} `);
    }
  });

  it('指标行格式为 name{labels} value', () => {
    const sampleLines = body.split('\n').filter((l) => l.startsWith('sciflow_') && !l.startsWith('sciflow_build_info'));
    expect(sampleLines.length).toBeGreaterThan(5);
    for (const line of sampleLines) {
      expect(line).toMatch(/^sciflow_[a-z0-9_]+(\{[^}]*\})? -?\d+$/);
    }
  });

  it('暴露 up 与数据库延迟', () => {
    expect(body).toMatch(/^sciflow_up 1$/m);
    expect(body).toMatch(/^sciflow_db_latency_ms -?\d+$/m);
  });

  it('build_info 带版本标签', () => {
    expect(body).toMatch(/^sciflow_build_info\{[^}]*version="[^"]*"[^}]*\} 1$/m);
  });

  it('以换行结尾（scrape 解析器要求）', () => {
    expect(body.endsWith('\n')).toBe(true);
  });

  it('不含未替换的占位或 undefined', () => {
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('NaN');
  });
});
