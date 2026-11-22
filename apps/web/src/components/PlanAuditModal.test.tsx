import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanAuditResult } from '../types';
import { PlanAuditModal } from './PlanAuditModal';

const result: PlanAuditResult = {
  ok: false,
  title: 'HRM 研究计划',
  chars: 9071,
  score: 0,
  blockers: 1,
  warnings: 1,
  findings: [
    {
      id: 'sample-flow',
      severity: 'blocker',
      category: 'sample',
      message: 'T1 140 人、流失 25%，只能得到约 105 个配对样本，低于计划声明的 200 对。',
      evidence: 'T1 目标 140；配对目标 200；流失 25%',
      suggestion: '先统一样本流：按可招募人数重算配对目标，或调整流失假设。',
    },
    {
      id: 'journal-no-name',
      severity: 'warning',
      category: 'journal',
      message: '目标期刊只写了分区，没有具体刊名。',
      suggestion: '补 2–3 本具体候选期刊与投稿理由。',
    },
  ],
  metrics: { t1Target: 140, pairedTarget: 200, attritionPct: 25, gapWeeks: 1, lagWeeks: 4 },
  summary: '未通过：1 个 blocker、1 个警告；先修 blocker，再谈可执行/可投稿。',
};

describe('PlanAuditModal', () => {
  afterEach(cleanup);

  it('展示硬门禁、警告与样本流指标', () => {
    render(<PlanAuditModal open onClose={() => {}} loading={false} error="" result={result} />);
    expect(screen.getByText('未通过硬门禁')).toBeInTheDocument();
    expect(screen.getByText('必须先修')).toBeInTheDocument();
    expect(screen.getByText(/只能得到约 105 个配对样本/)).toBeInTheDocument();
    expect(screen.getByText(/目标期刊只写了分区/)).toBeInTheDocument();
    expect(screen.getByText('T1 目标 140 人')).toBeInTheDocument();
    expect(screen.getByText('配对目标 200 对')).toBeInTheDocument();
    expect(screen.getByText('实际间隔 1 周')).toBeInTheDocument();
  });
});
