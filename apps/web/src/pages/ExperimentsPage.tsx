import { useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Beaker, Check, Copy, Loader2, Play, RotateCcw, Save, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { ToastContext } from '../App';
import type { Doc, Experiment, Project } from '../types';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Input, SectionTitle, Select, Textarea, errMsg } from '../components/ui';
import { ExperimentDesignCard } from './experiments/DesignCard';

const DEFAULT_CODE = `# 在本机沙箱中运行 Python（超时 10s，临时目录隔离）
import math

result = sum(math.sqrt(i) for i in range(1, 101))
print(f"sqrt(1..100) 之和 = {result:.4f}")

# 如需出图，matplotlib 直接 savefig('fig.png') 即可被自动采集
# import matplotlib
# matplotlib.use('Agg')
# import matplotlib.pyplot as plt
# plt.plot([0, 1, 2], [0, 1, 4])
# plt.savefig('fig.png')
`;

function statusBadge(s: Experiment['status']) {
  if (s === 'ok') return <Badge tone="green">成功</Badge>;
  if (s === 'timeout') return <Badge tone="amber">超时</Badge>;
  return <Badge tone="red">失败</Badge>;
}

/** 后端 NO_PYTHON_MESSAGE 的标记子串；命中则渲染专门引导卡片而非红色 stderr 框 */
const NO_PYTHON_MARKER = '未检测到 Python';
const isNoPythonError = (exp: Experiment | null) =>
  !!exp && exp.status === 'error' && !!exp.stderr && exp.stderr.includes(NO_PYTHON_MARKER);

const INSTALL_CMDS: { platform: string; cmd: string; hint: string }[] = [
  { platform: 'Windows', cmd: 'winget install Python.Python.3.12', hint: '或从 python.org 下载安装包，安装时勾选 Add to PATH' },
  { platform: 'macOS', cmd: 'brew install python3', hint: '需先安装 Homebrew' },
  { platform: 'Linux (Debian/Ubuntu)', cmd: 'sudo apt install python3', hint: 'Fedora/RHEL 用 sudo dnf install python3' },
];

export function ExperimentsPage({ project }: { project: Project }) {
  // experiments 列表 + 文档下拉（React Query）
  const [selected, setSelected] = useState<Experiment | null>(null);
  const qc = useQueryClient();
  const [goal, setGoal] = useState('');
  const [code, setCode] = useState(DEFAULT_CODE);
  const [documentId, setDocumentId] = useState('');
  const [running, setRunning] = useState(false);
  const [conclusionDraft, setConclusionDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Experiment | null>(null);
  /** 差距#23：正在「重新运行」的记录 id（列表按钮 loading 态） */
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copiedCmd, setCopiedCmd] = useState<string>('');
  /**
   * 仅缓存「最近一次 run() 响应」里的 memoryMonitored（运行时字段，不入库）。
   * 历史记录从 list() 加载时该字段恒为 undefined，不显示标注（数据不可回溯）。
   */
  const [lastRunMem, setLastRunMem] = useState<{ id: string; value: boolean } | null>(null);
  const toast = useContext(ToastContext);

  const copyCmd = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(cmd);
      setTimeout(() => setCopiedCmd(''), 1500);
    } catch {
      /* 剪贴板不可用则静默 */
    }
  };

  const expsQuery = useQuery({
    queryKey: ['exps', project.id],
    queryFn: async () => {
      const [list, docList] = await Promise.all([api.experiments.list(project.id), api.documents.list(project.id).catch(() => [] as Doc[])]);
      return { list, docList };
    },
  });
  const exps: Experiment[] = expsQuery.data?.list ?? [];
  const docs: Doc[] = expsQuery.data?.docList ?? [];
  const invalidateExps = () => void qc.invalidateQueries({ queryKey: ['exps', project.id] });

  const run = async () => {
    if (!code.trim() || running) return;
    setRunning(true);
    setError('');
    try {
      const exp = await api.experiments.run({
        projectId: project.id,
        goal: goal.trim(),
        code,
        documentId: documentId || null,
      });
      invalidateExps();
      setSelected(exp);
      setConclusionDraft(exp.conclusion);
      if (typeof exp.memoryMonitored === 'boolean') {
        setLastRunMem({ id: exp.id, value: exp.memoryMonitored });
      }
      toast(exp.status === 'ok' ? 'success' : 'info', `实验执行${exp.status === 'ok' ? '成功' : `：${exp.status}`}`);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setRunning(false);
    }
  };

  const select = (exp: Experiment) => {
    setSelected(exp);
    setConclusionDraft(exp.conclusion);
  };

  /**
   * 差距#23 轻量版：重新运行——沿用原记录的 projectId/goal/code/documentId
   * 再调一次 experiments.run（现有 experiment 表每次 run 即一行，列表天然是执行历史，无需新表）。
   * 无 python3 时后端返回 error 记录并渲染既有琥珀引导卡。
   */
  const rerun = async (exp: Experiment) => {
    if (rerunningId) return;
    setRerunningId(exp.id);
    setError('');
    try {
      const fresh = await api.experiments.run({
        projectId: project.id,
        goal: exp.goal,
        code: exp.code,
        documentId: exp.documentId,
      });
      invalidateExps();
      setSelected(fresh);
      setConclusionDraft(fresh.conclusion);
      if (typeof fresh.memoryMonitored === 'boolean') {
        setLastRunMem({ id: fresh.id, value: fresh.memoryMonitored });
      }
      toast('success', `已重新运行：实验${fresh.status === 'ok' ? '执行成功' : `状态 ${fresh.status}`}`);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setRerunningId(null);
    }
  };

  const saveConclusion = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const updated = await api.experiments.update(selected.id, { conclusion: conclusionDraft });
      invalidateExps();
      setSelected(updated);
      toast('success', '结论已保存');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.experiments.remove(deleting.id);
      invalidateExps();
      if (selected?.id === deleting.id) setSelected(null);
      toast('info', '实验记录已删除');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="page-container">
      <ErrorBox message={error} />
      <div className="grid lg:grid-cols-5 gap-4">
        {/* 左：新建实验表单 */}
        <Card className="p-4 sm:p-5 lg:col-span-2 h-fit">
          <SectionTitle>
            <span className="flex items-center gap-2">
              <Beaker size={16} className="text-teal-600" /> 新建实验
            </span>
          </SectionTitle>
          <div className="space-y-3">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">实验目的 / 假设（可选）</div>
              <Input placeholder="例如：验证牛顿法在 x^2-2 上的收敛速度" value={goal} onChange={(e) => setGoal(e.target.value)} />
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">关联文档（可选）</div>
              <Select
                className="w-full"
                value={documentId}
                onChange={setDocumentId}
                options={[{ value: '', label: '不关联文档' }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
              />
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Python 代码</div>
              <Textarea rows={12} className="font-mono text-xs" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
            </div>
            <Button onClick={run} loading={running} disabled={!code.trim()} className="w-full">
              {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {running ? '执行中（超时 10s）…' : '运行实验'}
            </Button>
            <div className="text-[11px] text-slate-400 leading-relaxed">
              在本机临时目录隔离执行 python3：超时自动强杀进程组，stdout/stderr 各截断 64KB；matplotlib savefig('*.png') 会自动采集为插图。
            </div>
          </div>
        </Card>

        {/* 左下：F3 实验设计助手（研究问题 → 结构化设计稿） */}
        <div className="lg:col-span-2">
          <ExperimentDesignCard project={project} />
        </div>

        {/* 右：历史列表 + 详情 */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="p-4 sm:p-5">
            <SectionTitle extra={<span className="text-xs text-slate-400">{exps.length} 条记录</span>}>
              <span className="flex items-center gap-2">
                <Beaker size={16} className="text-teal-600 dark:text-teal-300" /> 实验记录
              </span>
            </SectionTitle>
            {exps.length === 0 ? (
              <Empty illustration="pipeline" text="还没有实验记录" hint="在左侧写一段 Python 并运行，结果与图表会保存在这里" />
            ) : (
              <div className="space-y-2">
                {exps.map((exp) => (
                  <div
                    key={exp.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => select(exp)}
                    onKeyDown={(e) => e.key === 'Enter' && select(exp)}
                    className={`w-full text-left rounded-lg px-3 py-2.5 border transition-colors cursor-pointer ${
                      selected?.id === exp.id
                        ? 'border-teal-400 bg-teal-50/70 dark:bg-teal-900/20'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {statusBadge(exp.status)}
                      <span className="text-sm text-slate-800 dark:text-slate-100 truncate flex-1">
                        {exp.goal || exp.code.split('\n')[0].slice(0, 40) || '未命名实验'}
                      </span>
                      <span className="text-[11px] text-slate-400 shrink-0">{(exp.runtimeMs / 1000).toFixed(1)}s</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          rerun(exp);
                        }}
                        disabled={rerunningId === exp.id}
                        title="用相同代码与目的再跑一次（执行历史即新记录）"
                        className="shrink-0 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-teal-600 disabled:opacity-50"
                      >
                        {rerunningId === exp.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                        重新运行
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {selected && (
            <Card className="p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {statusBadge(selected.status)}
                <span className="text-[11px] text-slate-400">
                  {new Date(selected.createdAt).toLocaleString()} · 耗时 {(selected.runtimeMs / 1000).toFixed(2)}s
                </span>
              {/* memoryMonitored 是 run() 响应的运行时字段（不入库）；仅当选中的是最近一次刚跑完的记录时才显示标注 */}
              {(() => {
                const mem = lastRunMem && lastRunMem.id === selected.id ? lastRunMem.value : undefined;
                if (mem === true) return <span className="text-[11px] text-teal-600 dark:text-teal-400">内存监控：可用（上限 1GB）</span>;
                if (mem === false && !isNoPythonError(selected)) return <span className="text-[11px] text-amber-500">内存监控：本环境不可用（超时仍生效）</span>;
                return null;
              })()}
                <button onClick={() => setDeleting(selected)} className="ml-auto text-slate-400 hover:text-rose-500" title="删除记录">
                  <Trash2 size={15} />
                </button>
              </div>

              {selected.goal && <div className="text-sm text-slate-600 dark:text-slate-300 mb-3">目的：{selected.goal}</div>}

              {/* stdout */}
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                标准输出{selected.stdoutTruncated && <span className="text-amber-500">（已截断）</span>}
              </div>
              <pre className="rounded-lg bg-slate-950 text-emerald-300 text-xs font-mono p-3 overflow-x-auto max-h-56 overflow-y-auto whitespace-pre-wrap">
                {selected.stdout || '（空）'}
              </pre>
              {/* 无 Python 解释器：专门引导卡片（替代红色 stderr 框） */}
              {isNoPythonError(selected) ? (
                <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">
                        本机未检测到可用的 Python 3
                      </div>
                      <div className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed mb-3">
                        实验沙箱需要本机 Python 3 才能运行代码。请按你的系统安装后重启应用：
                      </div>
                      <div className="space-y-2">
                        {INSTALL_CMDS.map((item) => (
                          <div key={item.platform} className="flex items-center gap-2">
                            <span className="text-[11px] text-amber-700 dark:text-amber-300 w-28 shrink-0">{item.platform}</span>
                            <code className="flex-1 text-[11px] font-mono bg-amber-100/70 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 rounded px-2 py-1 truncate">
                              {item.cmd}
                            </code>
                            <button
                              onClick={() => copyCmd(item.cmd)}
                              className="text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 shrink-0"
                              title="复制安装命令"
                            >
                              {copiedCmd === item.cmd ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="text-[11px] text-amber-600/80 dark:text-amber-400/80 mt-3">
                        安装完成后重启 SciFlow 应用即可。若已安装但仍提示，请确认 python 已加入 PATH。
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                selected.stderr && (
                  <>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1 mt-3">
                      标准错误{selected.stderrTruncated && <span className="text-amber-500">（已截断）</span>}
                    </div>
                    <pre className="rounded-lg bg-rose-950/60 text-rose-200 text-xs font-mono p-3 overflow-x-auto max-h-56 overflow-y-auto whitespace-pre-wrap">
                      {selected.stderr}
                    </pre>
                  </>
                )
              )}

              {/* figures */}
              {selected.figures.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">输出图表（{selected.figures.length}）</div>
                  <div className="grid grid-cols-2 gap-3">
                    {selected.figures.map((f, i) => (
                      <img key={i} src={f} alt={`fig-${i + 1}`} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white" />
                    ))}
                  </div>
                </div>
              )}

              {/* conclusion */}
              <div className="mt-4">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">实验结论</div>
                <Textarea rows={3} placeholder="记录本次实验的发现、局限与下一步…" value={conclusionDraft} onChange={(e) => setConclusionDraft(e.target.value)} />
                <div className="mt-2 flex justify-end">
                  <Button variant="outline" onClick={saveConclusion} loading={saving}>
                    <Save size={14} /> 保存结论
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {!selected && exps.length > 0 && <div className="text-center text-xs text-slate-400 py-4">选择一条记录查看输出与图表</div>}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleting}
        title="删除实验记录"
        description="确定删除这条实验记录吗？删除后无法恢复。"
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
