import { useContext, useEffect, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Save, Target, X } from 'lucide-react';
import { api } from '../../api/client';
import { qk } from '../../lib/query-keys';
import { Badge, Button, Card, Textarea, errMsg } from '../../components/ui';
import { ToastContext } from '../../App';

type BriefDraft = {
  question: string;
  scope: string;
  methods: string;
  constraints: string;
  successCriteria: string;
};

const EMPTY: BriefDraft = { question: '', scope: '', methods: '', constraints: '', successCriteria: '' };

function pick(data: Partial<BriefDraft> | undefined): BriefDraft {
  return {
    question: data?.question ?? '',
    scope: data?.scope ?? '',
    methods: data?.methods ?? '',
    constraints: data?.constraints ?? '',
    successCriteria: data?.successCriteria ?? '',
  };
}

/** 驾驶舱里的研究契约卡：让「研究问题/边界/成功标准」成为 Agent 可自动读取的上下文。 */
export function ResearchBriefCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useContext(ToastContext);
  const query = useQuery({
    queryKey: qk.brief(projectId),
    queryFn: () => api.brief.get(projectId),
    retry: 0,
  });
  const [draft, setDraft] = useState<BriefDraft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!query.data || loaded) return;
    setDraft(pick(query.data));
    setLoaded(true);
  }, [query.data, loaded]);

  const filled = Object.values(draft).some((v) => v.trim());
  const set = (key: keyof BriefDraft) => (e: ChangeEvent<HTMLTextAreaElement>) =>
    setDraft((prev) => ({ ...prev, [key]: e.target.value }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await api.brief.update(projectId, {
        question: draft.question.trim(),
        scope: draft.scope.trim(),
        methods: draft.methods.trim(),
        constraints: draft.constraints.trim(),
        successCriteria: draft.successCriteria.trim(),
      });
      qc.setQueryData(qk.brief(projectId), saved);
      setDraft(pick(saved));
      setEditing(false);
      toast('success', '研究 Brief 已保存，后续对话与研究计划会自动读取');
    } catch (e: unknown) {
      toast('error', errMsg(e) || '研究 Brief 保存失败');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(pick(query.data));
    setEditing(false);
  };

  return (
    <Card className="mb-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <Target size={15} className="text-teal-600 dark:text-teal-400" aria-hidden="true" />
            研究 Brief
            {filled ? <Badge tone="green">Agent 已读取</Badge> : <Badge tone="amber">待设置</Badge>}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            研究问题、边界、方法与成功标准。对话和研究计划会自动注入，不是写作偏好。
          </p>
        </div>
        {!editing && (
          <Button variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={() => setEditing(true)}>
            <Pencil size={12} /> {filled ? '编辑' : '设置'}
          </Button>
        )}
      </div>

      {query.isError && !editing && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">Brief 读取失败，可稍后重试；不影响其他模块。</p>
      )}

      {editing ? (
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">研究问题</label>
            <Textarea rows={2} value={draft.question} onChange={set('question')} placeholder="例：图神经网络在低资源中文文本分类上是否优于微调？" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">范围与边界</label>
              <Textarea rows={3} value={draft.scope} onChange={set('scope')} placeholder="做什么、不做什么、样本口径" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">方法与数据</label>
              <Textarea rows={3} value={draft.methods} onChange={set('methods')} placeholder="数据来源、对照组、分析方式" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">约束</label>
              <Textarea rows={3} value={draft.constraints} onChange={set('constraints')} placeholder="算力、时间、伦理、预算等硬约束" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">成功标准</label>
              <Textarea rows={3} value={draft.successCriteria} onChange={set('successCriteria')} placeholder="什么结果算成立/可投稿" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="h-7 px-2 text-xs" onClick={cancel} disabled={saving}>
              <X size={12} /> 取消
            </Button>
            <Button className="h-7 px-2 text-xs" onClick={save} disabled={saving}>
              <Save size={12} /> {saving ? '保存中…' : '保存 Brief'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          {filled ? (
            <>
              <p className="text-sm font-medium leading-relaxed text-slate-800 dark:text-slate-100">
                {draft.question || '尚未填写研究问题'}
              </p>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs md:grid-cols-2">
                {[
                  ['范围与边界', draft.scope],
                  ['方法与数据', draft.methods],
                  ['约束', draft.constraints],
                  ['成功标准', draft.successCriteria],
                ].map(([label, value]) => (
                  <div key={label as string} className="min-w-0">
                    <dt className="font-medium text-slate-400 dark:text-slate-500">{label}</dt>
                    <dd className="mt-0.5 line-clamp-2 text-slate-600 dark:text-slate-300">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-slate-400 dark:text-slate-500">
              尚未设置。填写后，AI 对话会自动带上研究契约；PI 制定研究计划时会优先遵守范围、约束与成功标准。
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
