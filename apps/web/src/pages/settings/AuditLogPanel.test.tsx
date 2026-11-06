import { describe, expect, it } from 'vitest';
import { parseMetrics } from './AuditLogPanel';

/**
 * Prometheus 文本解析的契约测试：面板上显示的数字必须来自真实指标行，
 * 不能被注释、build_info 或畸形行污染（显示错误数字比不显示更糟）。
 */
const SAMPLE = `# HELP sciflow_up Whether the service and its database are reachable
# TYPE sciflow_up gauge
sciflow_build_info{version="1.14.0",desktop="false"} 1
sciflow_up 1
# HELP sciflow_db_latency_ms Round-trip latency
# TYPE sciflow_db_latency_ms gauge
sciflow_db_latency_ms 3
sciflow_projects_total 2
sciflow_documents_total 7
sciflow_llm_calls_total 128
sciflow_unknown_metric 99
garbage line
`;

describe('parseMetrics', () => {
  it('解析已知指标为可读标签 + 数值', () => {
    const rows = parseMetrics(SAMPLE);
    const up = rows.find((r) => r.name === 'sciflow_up');
    expect(up?.value).toBe('1');
    expect(rows.find((r) => r.name === 'sciflow_db_latency_ms')?.value).toBe('3');
    expect(rows.find((r) => r.name === 'sciflow_projects_total')?.label).toBe('项目数');
  });

  it('忽略注释、build_info 与未知指标', () => {
    const names = parseMetrics(SAMPLE).map((r) => r.name);
    expect(names).not.toContain('sciflow_build_info');
    expect(names).not.toContain('sciflow_unknown_metric');
    expect(names.every((n) => !n.startsWith('#'))).toBe(true);
  });

  it('忽略畸形行而不抛错', () => {
    expect(() => parseMetrics('garbage\nsciflow_up\nsciflow_up abc')).not.toThrow();
    expect(parseMetrics('garbage\nsciflow_up\nsciflow_up abc')).toEqual([]);
  });

  it('空输入返回空数组', () => {
    expect(parseMetrics('')).toEqual([]);
  });

  it('按曝光顺序保留指标（面板顺序稳定）', () => {
    const names = parseMetrics(SAMPLE).map((r) => r.name);
    expect(names[0]).toBe('sciflow_up');
    expect(names.indexOf('sciflow_db_latency_ms')).toBeLessThan(names.indexOf('sciflow_projects_total'));
  });
});
