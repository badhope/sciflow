import { describe, expect, it } from 'vitest';
import { auditResearchPlan } from './plan-audit';

const badPlan = `# 人力资源管理论文研究计划

## 1 路线
路线 B：以“员工对 HR 实践的感知”为核心自变量。

## 2 研究问题
RQ1：组织提供的 HR 实践是否通过员工感知可用性影响工作投入？

## 3 样本
T1 目标样本约 130–140 人，流失率约 25%；配对样本 ≥200。

## 4 测量
| 变量 | 角色 | 测量方式 |
|---|---|---|
| HR 实践水平 | 自变量 | 员工自评已发表量表 |
| 感知可用性 | 中介 | 员工自评自编量表 |

自编量表做 5–8 人预试。具体量表须检索原文，本计划不指定具体条目。

## 5 理论缺口
员工是否感知到自己有权使用该实践，现有测量不足。该判断需通过系统检索核实，不得直接作为新颖性主张。

## 6 时间表
| 周 | 任务 |
|---|---|
| W6 | 提交 IRB |
| W7–W8 | T1 数据收集 |
| W9 | T2 数据收集（间隔 4 周需前移排期） |
| W12 | 写作 |

招募需要 4–6 周。采用横断—纵向混合设计。

## 7 期刊
目标为 SSCI 三区/四区或中文核心，具体刊名待核实。

## 8 参考文献
[1] BLAU P M. Exchange and power in social life[M]. 1964.
[2] BOWEN D E, OSTROFF C. Understanding HRM-firm performance linkages[J]. 2004.
[3] HAYES A F. Introduction to mediation, moderation, and conditional process analysis[M]. 2022.
`;

const cleanPlan = `# 研究计划

## 1 研究问题
RQ1：HR 经理报告的组织 HR 实践水平，是否通过员工感知可用性影响工作投入？

## 2 样本
T1 目标 270 人，流失率约 25%；T2 配对目标 200 人。

## 3 测量
| 变量 | 角色 | 来源 | 量表 |
|---|---|---|---|
| HR 实践水平 | 自变量 | HR 经理报告 | HR system strength scale |
| 感知可用性 | 中介 | 员工自评 | 心理可得性量表 |
| 工作投入 | 因变量 | 员工自评 | UWES |

## 4 时间表
| 周 | 任务 |
|---|---|
| W2–W4 | 提交 IRB 并等待批号 |
| W4–W8 | 招募 |
| W8–W10 | T1 数据收集 |
| W14–W16 | T2 数据收集（间隔 4 周） |
| W16–W18 | 分析与写作 |

## 5 理论缺口
已检索 OpenAlex/Crossref，检索式 "perceived availability HR practices"；最相近 3 篇为 2023/2021/2020，本文增量是区分组织提供与员工可用。

## 6 选刊
候选：Human Resource Management Journal、Personnel Review、Journal of Managerial Psychology。

## 7 参考文献
[1] NISHII L H, LEPAK D P, SCHNEIDER B. Employee attributions...[J]. 2008.
[2] BOWEN D E, OSTROFF C. Understanding HRM-firm performance linkages[J]. 2004.
[3] HAYES A F. Introduction to mediation...[M]. 2022.
[4] 2024 recent HRM implementation study.
[5] 2023 recent employee experience study.
`;

describe('auditResearchPlan', () => {
  it('抓出样本流矛盾：T1 130–140 不可能产出 200 配对样本', () => {
    const r = auditResearchPlan(badPlan);
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.id === 'sample-flow' && f.severity === 'blocker')).toBe(true);
    expect(r.metrics.t1Target).toBe(140);
    expect(r.metrics.pairedTarget).toBe(200);
  });

  it('抓出 4 周间隔与 W7–W9 排期冲突', () => {
    const r = auditResearchPlan(badPlan);
    const f = r.findings.find((x) => x.id === 'timeline-lag');
    expect(f?.severity).toBe('blocker');
    expect(r.metrics.gapWeeks).toBe(1);
    expect(r.metrics.lagWeeks).toBe(4);
  });

  it('抓出构念定义冲突与同源自评', () => {
    const r = auditResearchPlan(badPlan);
    expect(r.findings.some((f) => f.id === 'construct-definition-conflict')).toBe(true);
    expect(r.findings.some((f) => f.id === 'construct-same-source')).toBe(true);
  });

  it('抓出未核验缺口、具体量表缺失、选刊无刊名', () => {
    const r = auditResearchPlan(badPlan);
    expect(r.findings.some((f) => f.id === 'novelty-unverified' && f.severity === 'blocker')).toBe(true);
    expect(r.findings.some((f) => f.id === 'measurement-vague')).toBe(true);
    expect(r.findings.some((f) => f.id === 'journal-no-name')).toBe(true);
  });

  it('干净计划通过硬门禁，且不误报样本/排期', () => {
    const r = auditResearchPlan(cleanPlan);
    expect(r.ok).toBe(true);
    expect(r.findings.some((f) => f.id === 'sample-flow')).toBe(false);
    expect(r.findings.some((f) => f.id === 'timeline-lag')).toBe(false);
    expect(r.blockers).toBe(0);
  });

  it('空文本不抛错，返回低分与说明', () => {
    const r = auditResearchPlan('');
    expect(r.chars).toBe(0);
    expect(r.summary).toContain('未通过');
  });
});
