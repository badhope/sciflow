import { describe, expect, it } from 'vitest';
import { auditResearchPlan } from './plan-audit';
import { renderPlanAudit } from './research-cli';

const plan = `# 研究计划
## 样本
T1 目标 140 人，流失率 25%；配对样本 ≥200。
## 时间表
W6 提交 IRB；W7–W8 收 T1；W9 收 T2（间隔 4 周）。
## 理论缺口
需系统检索核实。
`;

describe('renderPlanAudit', () => {
  it('先给硬门禁结论，再列 blocker 证据与建议', () => {
    const r = auditResearchPlan(plan, '样本冲突计划');
    const out = renderPlanAudit(r);
    expect(out).toContain('# 样本冲突计划');
    expect(out).toContain('未通过硬门禁');
    expect(out).toContain('必须先修');
    expect(out).toContain('T1 目标 140');
    expect(out).toContain('建议：');
  });

  it('无标题时给占位标题，空文本不静默通过', () => {
    const r = auditResearchPlan('');
    const out = renderPlanAudit(r);
    expect(out).toContain('# (未命名研究计划)');
    expect(out).toContain('0 字');
    expect(out).toContain('未通过硬门禁');
  });
});
