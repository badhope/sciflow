import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Button, Empty, ErrorBox, Input, Select, Spinner, downloadBase64, errMsg } from '../../components/ui';
import { DocumentSelect } from '../../components/DocumentSelect';
import type { Doc, SubmissionReadiness } from '../../types';

const STATUS_META: Record<SubmissionReadiness['items'][number]['status'], {
  label: string;
  tone: 'green' | 'amber' | 'red';
  icon: typeof CheckCircle2;
}> = {
  pass: { label: '通过', tone: 'green', icon: CheckCircle2 },
  warn: { label: '提醒', tone: 'amber', icon: AlertTriangle },
  fail: { label: '阻塞', tone: 'red', icon: XCircle },
};

/**
 * 投稿就绪检查（投稿辅助页）。
 *
 * 回答的是“能不能交”，不是“稿子好不好”：复用客观质量门，并额外核对
 * 项目文献库、citation 表、摘要/关键词块。确定性、可复现，不调模型。
 */
export function SubmissionReadinessPanel({ projectId, docs }: { projectId: string; docs: Pick<Doc, 'id' | 'title'>[] }) {
  const [docId, setDocId] = useState('');
  const [pkgBusy, setPkgBusy] = useState(false);
  const [pkgMessage, setPkgMessage] = useState('');
  const [pkgError, setPkgError] = useState('');
  const [journal, setJournal] = useState('');
  const [template, setTemplate] = useState('generic');
  const query = useQuery({
    queryKey: ['submission-readiness', projectId, docId],
    queryFn: () => api.submission.readiness(projectId, docId),
    enabled: Boolean(docId),
  });
  const data = query.data;
  const error = query.error ? errMsg(query.error) : '';
  const qc = useQueryClient();
  const standardQuery = useQuery({
    queryKey: ['project-quality-standard', projectId],
    queryFn: () => api.projects.qualityStandard(projectId),
    enabled: Boolean(projectId),
  });
  const templatesQuery = useQuery({
    queryKey: ['submission-templates'],
    queryFn: () => api.submission.templates(),
  });
  const setStandard = useMutation({
    mutationFn: (value: string) => api.projects.setQualityStandard(projectId, value),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['project-quality-standard', projectId] });
      await query.refetch();
    },
  });

  const downloadPackage = async () => {
    if (!docId) return;
    setPkgBusy(true);
    setPkgError('');
    setPkgMessage('');
    try {
      const pkg = await api.submission.package(projectId, docId, { journal, template });
      downloadBase64(pkg.filename, pkg.base64, 'application/zip');
      setPkgMessage(
        `已生成 ${pkg.filename}（${Math.max(1, Math.round(pkg.size / 1024))} KB，${pkg.template.label}${pkg.figures.length ? `，图表 ${pkg.figures.length} 张` : ''}）：${pkg.files.map((f) => f.name).join(' / ')}`,
      );
    } catch (e) {
      setPkgError(errMsg(e));
    } finally {
      setPkgBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ClipboardCheck size={16} className="text-teal-600" />
            <h3 className="text-sm font-semibold">投稿就绪检查</h3>
            {data && <Badge tone={data.ready ? 'green' : 'red'}>{data.ready ? '可投稿' : '有阻塞项'}</Badge>}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            用当前评审标准核对标题、篇幅、章节、引用闭环、文献库、摘要/关键词与客观质量门；只读、不调模型，可反复刷新。
          </p>
        </div>
        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void downloadPackage()} loading={pkgBusy}>
              <Download size={13} /> 下载投稿包
            </Button>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
              <RefreshCw size={13} /> 重新检查
            </Button>
          </div>
        )}
      </div>

      <div className="mt-3">
        <DocumentSelect
          docs={docs}
          value={docId}
          onChange={(id) => setDocId(id ?? '')}
          placeholder="选择要投稿的项目文档…"
          ariaLabel="投稿文档"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>本项目评审标准</span>
        <Select
          ariaLabel="项目评审标准"
          className="!py-1.5"
          value={standardQuery.data?.key ?? 'standard'}
          onChange={(v) => setStandard.mutate(v)}
          options={[
            { value: 'draft', label: '草稿迭代 · 70 分' },
            { value: 'standard', label: 'SCI 通用期刊 · 80 分' },
            { value: 'conference', label: '会议论文 · 78 分' },
            { value: 'review', label: '综述 · 80 分' },
            { value: 'strict', label: '顶刊 · 85 分' },
          ]}
        />
        {standardQuery.data && (
          <Badge tone={standardQuery.data.source === 'project' ? 'teal' : 'slate'}>
            {standardQuery.data.source === 'project' ? '项目级' : standardQuery.data.source === 'global' ? '继承全局' : '默认'}
          </Badge>
        )}
        {setStandard.isPending && <span>保存中…</span>}
        {setStandard.error && <span className="text-rose-600">{errMsg(setStandard.error)}</span>}
      </div>

      {docId && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-slate-500 dark:text-slate-400">
            目标期刊（写进 Cover Letter，可留空）
            <Input
              value={journal}
              onChange={(e) => setJournal(e.target.value)}
              placeholder="例如 Journal of Graph Research"
              className="mt-1 !py-1.5"
              aria-label="目标期刊"
            />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            排版模板
            <Select
              ariaLabel="投稿排版模板"
              className="mt-1 w-full !py-1.5"
              value={template}
              onChange={setTemplate}
              options={(templatesQuery.data ?? [{ key: 'generic', label: '通用中文投稿', note: '' }]).map((t) => ({
                value: t.key,
                label: t.label,
              }))}
            />
          </label>
        </div>
      )}

      {!docId && <Empty compact text="先选择一篇项目文档" hint="检查不会修改稿件，只给出阻塞项与提醒。" />}
      {query.isLoading && <Spinner label="检查投稿材料…" />}
      {error && <ErrorBox message={`就绪检查失败：${error}`} />}
      {pkgError && <ErrorBox message={`投稿包生成失败：${pkgError}`} />}
      {pkgMessage && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[11px] leading-5 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          {pkgMessage}
        </div>
      )}

      {data && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">就绪分</div>
                <div className="text-2xl font-semibold tabular-nums">{data.score}%</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>{data.standard.label} · 客观质量门 ≥ {data.standard.passScore}</span>
                  <span>{data.failCount} 阻塞 · {data.warnCount} 提醒</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className={`h-full rounded-full ${
                      data.failCount > 0 ? 'bg-rose-500' : data.warnCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.max(0, Math.min(100, data.score))}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              正文 {data.stats.chars} 字 · 章节 {data.stats.sections} · 唯一引用 {data.stats.uniqueCitations} · 文献库{' '}
              {data.stats.libraryReferences} 条
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {data.items.map((it) => {
              const meta = STATUS_META[it.status];
              const Icon = meta.icon;
              return (
                <div
                  key={it.key}
                  className={`rounded-lg border px-3 py-2 ${
                    it.status === 'fail'
                      ? 'border-rose-200 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/30'
                      : it.status === 'warn'
                        ? 'border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30'
                        : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                      <Icon
                        size={14}
                        className={
                          it.status === 'fail' ? 'text-rose-600' : it.status === 'warn' ? 'text-amber-600' : 'text-emerald-600'
                        }
                      />
                      <span className="truncate">{it.label}</span>
                    </div>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-300">{it.detail}</p>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] leading-5 text-slate-400">
            这是投稿前的确定性自检，不替代期刊编辑初审；「提醒」不阻塞提交，「阻塞」建议先补齐再投。
            投稿包含 `manuscript.docx` / `cover-letter.md` / `references.bib` / `submission-checklist.md` / `figures/` / `manifest.json`；阻塞态也可下载，清单会保留阻塞项。
          </p>
        </div>
      )}
    </div>
  );
}
