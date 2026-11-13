import { useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus, RefreshCw, Target } from 'lucide-react';
import { api } from '../api/client';
import { ToastContext } from '../App';
import type { Project } from '../types';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Input,
  Select,
  errMsg,
  Spinner,
} from '../components/ui';
import {
  CYCLE_STATE,
  PROGRAM_STATUS,
  labelOf,
  statusTone,
} from './programs/labels';
import { QuestionBlock } from './programs/HypothesisProtocols';
import { ClaimEvidence } from './programs/ClaimEvidence';
import { RunCreator } from './programs/RunCreator';
import { ResearchCycleRunner } from './programs/ResearchCycleRunner';

const AUTONOMY = [
  { value: 'L2', label: 'L2 受监督执行（默认）' },
  { value: 'L3', label: 'L3 条件自主' },
  { value: 'L1', label: 'L1 建议' },
  { value: 'L0', label: 'L0 辅助' },
  { value: 'L4', label: 'L4 高度自主（需评测）' },
  { value: 'L5', label: 'L5 沙箱自主' },
];

function fmtTime(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—';
}

/**
 * 研究驾驶舱（阶段 2C 最小版）。
 *
 * 目标：让 Program/Cycle/Question/Claim/Run 可见、可创建，先验证信息架构；
 * 不做 Agent 控制、协议编辑与证据图谱，后续阶段再接。
 */
export function ResearchProgramsPage({ project }: { project: Project }) {
  const qc = useQueryClient();
  const toast = useContext(ToastContext);

  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [autonomy, setAutonomy] = useState('L2');
  const [creating, setCreating] = useState(false);

  const [cycleObjective, setCycleObjective] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [claimStatement, setClaimStatement] = useState('');
  const [claimConfidence, setClaimConfidence] = useState('60');
  const [busy, setBusy] = useState('');

  const listQuery = useQuery({
    queryKey: ['programs', project.id],
    queryFn: () => api.programs.list(project.id),
  });
  const programs = listQuery.data ?? [];
  // 默认选中第一个计划：直接派生，不在 effect 里 setState（避免级联渲染与 lint 红线）
  const activeId = selectedId || programs[0]?.id || '';
  const active = programs.find((p) => p.id === activeId);

  const detailQuery = useQuery({
    queryKey: ['program', activeId],
    queryFn: () => api.programs.get(activeId),
    enabled: Boolean(activeId),
  });
  const claimsQuery = useQuery({
    queryKey: ['program-claims', activeId],
    queryFn: () => api.programs.listClaims(activeId),
    enabled: Boolean(activeId),
  });
  const runsQuery = useQuery({
    queryKey: ['program-runs', activeId],
    queryFn: () => api.programs.listRuns(activeId),
    enabled: Boolean(activeId),
  });
  const protocolsQuery = useQuery({
    queryKey: ['program-protocols', activeId],
    queryFn: () => api.programs.listProgramProtocols(activeId),
    enabled: Boolean(activeId),
  });

  const createProgram = async () => {
    if (!title.trim()) {
      toast('error', '研究计划标题不能为空');
      return;
    }
    setCreating(true);
    try {
      const p = await api.programs.create(project.id, {
        title: title.trim(),
        goal: goal.trim(),
        autonomyLevel: autonomy,
      });
      setTitle('');
      setGoal('');
      setSelectedId(p.id);
      await qc.invalidateQueries({ queryKey: ['programs', project.id] });
      toast('success', `已创建研究计划「${p.title}」`);
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setCreating(false);
    }
  };

  const createCycle = async () => {
    if (!activeId || !cycleObjective.trim()) {
      toast('error', '请填写本轮研究目标');
      return;
    }
    setBusy('cycle');
    try {
      await api.programs.createCycle(activeId, { objective: cycleObjective.trim() });
      setCycleObjective('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['program', activeId] }),
        qc.invalidateQueries({ queryKey: ['program-runs', activeId] }),
      ]);
      toast('success', '已创建研究循环');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const createQuestion = async () => {
    if (!activeId || !questionText.trim()) {
      toast('error', '请填写研究问题');
      return;
    }
    setBusy('question');
    try {
      await api.programs.createQuestion(activeId, { question: questionText.trim() });
      setQuestionText('');
      await qc.invalidateQueries({ queryKey: ['program', activeId] });
      toast('success', '已创建研究问题');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const createClaim = async () => {
    if (!activeId || !claimStatement.trim()) {
      toast('error', '请填写结论陈述');
      return;
    }
    const confidence = Number(claimConfidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
      toast('error', '置信度需为 0-100');
      return;
    }
    setBusy('claim');
    try {
      await api.programs.createClaim(activeId, {
        statement: claimStatement.trim(),
        confidence,
      });
      setClaimStatement('');
      await qc.invalidateQueries({ queryKey: ['program-claims', activeId] });
      toast('success', '已记录研究结论');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const refreshAll = async () => {
    await qc.invalidateQueries({ queryKey: ['programs', project.id] });
    if (activeId) {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['program', activeId] }),
        qc.invalidateQueries({ queryKey: ['program-claims', activeId] }),
        qc.invalidateQueries({ queryKey: ['program-runs', activeId] }),
        qc.invalidateQueries({ queryKey: ['program-protocols', activeId] }),
      ]);
    }
  };

  const detail = detailQuery.data;
  const claims = claimsQuery.data ?? [];
  const runs = runsQuery.data ?? [];

  return (
    <div className="page-pad mx-auto max-w-6xl space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">研究计划概览</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            以 Program → Cycle → Question → Claim/Run 组织自主科研；默认 L2，协议审批后才允许运行。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshAll()}>
          <RefreshCw size={13} /> 刷新
        </Button>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <FlaskConical size={16} className="text-teal-600" /> 新建研究计划
        </div>
        <div className="grid gap-3 md:grid-cols-[1.2fr_2fr_auto]">
          <Input placeholder="标题，如：图神经网络复现" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input placeholder="研究目标（可选）" value={goal} onChange={(e) => setGoal(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Select options={AUTONOMY} value={autonomy} onChange={setAutonomy} ariaLabel="自主等级" />
            <Button onClick={() => void createProgram()} loading={creating} disabled={creating}>
              <Plus size={14} /> 创建
            </Button>
          </div>
        </div>
      </Card>

      {listQuery.isError && <ErrorBox message={`研究计划加载失败：${errMsg(listQuery.error)}`} />}
      {listQuery.isLoading && <Spinner label="加载研究计划…" />}

      {!listQuery.isLoading && programs.length === 0 && (
        <Empty text="还没有研究计划" hint="先创建一个 Program，再添加研究循环、问题与结论。" illustration="pipeline" />
      )}

      {programs.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="p-2">
            <div className="space-y-1">
              {programs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    p.id === activeId
                      ? 'bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{p.title}</span>
                    <Badge tone={statusTone(p.status)}>{labelOf(PROGRAM_STATUS, p.status)}</Badge>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{p.autonomyLevel}</span>
                    <span>·</span>
                    <span>{fmtTime(p.createdAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            {!active && <Empty text="选择左侧研究计划查看详情" />}
            {active && (
              <>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Target size={16} className="text-teal-600" />
                        <h3 className="truncate text-base font-semibold">{active.title}</h3>
                        <Badge tone={statusTone(active.status)}>{labelOf(PROGRAM_STATUS, active.status)}</Badge>
                        <Badge tone="blue">{active.autonomyLevel}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{active.goal || '未填写研究目标'}</p>
                    </div>
                    <span className="text-[11px] text-slate-400">创建 {fmtTime(active.createdAt)}</span>
                  </div>
                  {detailQuery.isError && <ErrorBox message={`详情加载失败：${errMsg(detailQuery.error)}`} />}
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                      <div className="text-[11px] text-slate-500">循环</div>
                      <div className="text-lg font-semibold">{detail?.cycles.length ?? 0}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                      <div className="text-[11px] text-slate-500">问题</div>
                      <div className="text-lg font-semibold">{detail?.questions.length ?? 0}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                      <div className="text-[11px] text-slate-500">结论 / 运行</div>
                      <div className="text-lg font-semibold">{claims.length} / {runs.length}</div>
                    </div>
                  </div>
                </Card>

                {detailQuery.isLoading && <Spinner label="加载研究计划详情…" />}
                {claimsQuery.isError && <ErrorBox message={`结论加载失败：${errMsg(claimsQuery.error)}`} />}
                {runsQuery.isError && <ErrorBox message={`运行记录加载失败：${errMsg(runsQuery.error)}`} />}

                <Card className="p-4">
                  <ResearchCycleRunner
                    programId={activeId}
                    programTitle={active.title}
                    autonomyLevel={active.autonomyLevel}
                    onChanged={() => void refreshAll()}
                  />
                </Card>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">研究循环</h4>
                      <span className="text-[11px] text-slate-400">{detail?.cycles.length ?? 0} 轮</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Input className="min-w-[180px] flex-1" placeholder="本轮目标" value={cycleObjective} onChange={(e) => setCycleObjective(e.target.value)} />
                      <Button size="sm" variant="outline" loading={busy === 'cycle'} onClick={() => void createCycle()}>
                        <Plus size={13} /> 添加
                      </Button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(detail?.cycles ?? []).map((c) => (
                        <div key={c.id} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">第 {c.seq} 轮</span>
                            <Badge tone={statusTone(c.state)}>{labelOf(CYCLE_STATE, c.state)}</Badge>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{c.objective || '无目标描述'}</div>
                        </div>
                      ))}
                      {!detail?.cycles.length && <Empty compact text="还没有研究循环" />}
                    </div>
                  </Card>

                  <Card className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">研究问题</h4>
                      <span className="text-[11px] text-slate-400">{detail?.questions.length ?? 0} 个</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Input className="min-w-[180px] flex-1" placeholder="研究问题" value={questionText} onChange={(e) => setQuestionText(e.target.value)} />
                      <Button size="sm" variant="outline" loading={busy === 'question'} onClick={() => void createQuestion()}>
                        <Plus size={13} /> 添加
                      </Button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(detail?.questions ?? []).map((q) => (
                        <QuestionBlock key={q.id} question={q} onChanged={() => void refreshAll()} />
                      ))}
                      {!detail?.questions.length && <Empty compact text="还没有研究问题" />}
                    </div>
                  </Card>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">结论与证据</h4>
                      <span className="text-[11px] text-slate-400">{claims.length} 条</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input className="min-w-[180px] flex-1" placeholder="结论陈述" value={claimStatement} onChange={(e) => setClaimStatement(e.target.value)} />
                      <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">
                        <span>置信度</span>
                        <Input
                          className="w-20"
                          type="number"
                          min={0}
                          max={100}
                          value={claimConfidence}
                          onChange={(e) => setClaimConfidence(e.target.value)}
                          aria-label="置信度"
                        />
                      </label>
                      <Button size="sm" variant="outline" loading={busy === 'claim'} onClick={() => void createClaim()}>
                        <Plus size={13} /> 记录
                      </Button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {claims.map((c) => (
                        <ClaimEvidence key={c.id} claim={c} onChanged={() => void refreshAll()} />
                      ))}
                      {!claims.length && <Empty compact text="还没有结论" hint="先记录结论，再在结论下登记支持/反驳证据并核验" />}
                    </div>
                  </Card>

                  <Card className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">研究运行</h4>
                      <span className="text-[11px] text-slate-400">{runs.length} 次</span>
                    </div>
                    <RunCreator
                      programId={activeId}
                      protocols={protocolsQuery.data ?? []}
                      runs={runs}
                      onChanged={() => void refreshAll()}
                    />
                  </Card>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
