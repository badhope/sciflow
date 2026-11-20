import { Check, Forward, Loader2, Mail, MessageSquareReply, Trash2 } from 'lucide-react';
import type { Doc, ParseEmailResult, SubmissionStatus, SubmissionTrack } from '../../types';
import { Badge, Button, Card, Input, Select, Textarea } from '../../components/ui';
import { REVISION_STATUSES, STATUS_META, STATUS_OPTIONS, STEPPER_CHAIN, TERMINAL, fmtDate, revisionBadge } from './status';

type Props = {
  track: SubmissionTrack;
  docs: Doc[];
  openCount: number;
  forwardJournalName?: string;
  busy: boolean;
  eventOpen: boolean;
  evStatus: SubmissionStatus;
  evNote: string;
  evDeadline: string;
  deadlineOpen: boolean;
  deadlineVal: string;
  emailOpen: boolean;
  emailText: string;
  parsing: boolean;
  parseResult: ParseEmailResult | null;
  confirming: boolean;
  historyOpen: boolean;
  onToggleEvent: () => void;
  onStatusChange: (status: SubmissionStatus) => void;
  onNoteChange: (note: string) => void;
  onDeadlineChange: (deadline: string) => void;
  onConfirmEvent: () => void;
  onToggleDeadline: () => void;
  onDeadlineValueChange: (value: string) => void;
  onSaveDeadline: () => void;
  onToggleEmail: () => void;
  onEmailTextChange: (text: string) => void;
  onParseEmail: () => void;
  onDismissParse: () => void;
  onConfirmParse: () => void;
  onToggleHistory: () => void;
  onTransfer: () => void;
  onRecordFromReview: () => void;
  onDelete: () => void;
};

/** 单条投稿记录卡片：状态、截止日、Stepper、事件、邮件解析与历史。 */
export function TrackCard(props: Props) {
  const { track: t, docs, openCount, busy } = props;
  const meta = STATUS_META[t.currentStatus] || STATUS_META.submitted;
  const docTitle = t.documentId ? docs.find((d) => d.id === t.documentId)?.title : '';
  const stepIdx = STEPPER_CHAIN.indexOf(t.currentStatus);

  return (
    <Card className="p-4 mb-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t.journalName}</span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">{meta.group}</span>
        {props.forwardJournalName && (
          <span className="text-[11px] text-teal-700 dark:text-teal-400">
            已转投 → {props.forwardJournalName}
          </span>
        )}
        <div className="ml-auto flex gap-1.5 items-center">
          <button className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline" onClick={props.onToggleEvent}>更新状态</button>
          {TERMINAL.has(t.currentStatus) && (
            <button className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline" title="用同一稿件登记新期刊（自动串联旧记录）" onClick={props.onTransfer}>
              <Forward size={11} className="inline mr-0.5" />转投他刊
            </button>
          )}
          <button className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline" onClick={props.onToggleDeadline}>
            {t.revisionDeadline ? '改截止日' : '设截止日'}
          </button>
          <button className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline" onClick={props.onToggleEmail}>
            <Mail size={11} className="inline mr-0.5" />解析邮件
          </button>
          <button
            className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline disabled:text-slate-300 dark:disabled:text-slate-600 disabled:cursor-not-allowed disabled:no-underline"
            disabled={!t.documentId || openCount === 0 || busy}
            title={
              !t.documentId
                ? '该投稿未关联论文文档'
                : openCount === 0
                  ? '该稿件文档没有待处理（open）的审稿意见'
                  : `按 ${openCount} 条 open 审稿意见自动推断状态并记录事件`
            }
            onClick={props.onRecordFromReview}
          >
            <MessageSquareReply size={11} className="inline mr-0.5" />审稿→事件{openCount ? `（${openCount}）` : ''}
          </button>
          <button className="p-1 text-slate-400 hover:text-rose-500" title="删除投稿记录" aria-label="删除投稿记录" onClick={props.onDelete}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
        {docTitle || t.title || '（未命名稿件）'} · 投稿于 {fmtDate(t.submittedAt)}
      </div>

      {/* 修回截止日倒计时 */}
      {t.revisionDeadline && (
        <div className="mt-1.5 text-[11px]">
          {revisionBadge(t.revisionDeadline)}
          <span className="ml-1.5 text-slate-400 dark:text-slate-500">截止 {fmtDate(t.revisionDeadline)}</span>
        </div>
      )}
      {props.deadlineOpen && (
        <div className="mt-2 flex items-center gap-2">
          <Input type="date" value={props.deadlineVal} onChange={(e) => props.onDeadlineValueChange(e.target.value)} />
          <Button className="text-xs px-2 py-1" onClick={props.onSaveDeadline}>保存</Button>
        </div>
      )}

      {/* L3 周期推断提示 */}
      {t.dueAt && !TERMINAL.has(t.currentStatus) && (
        <div className="mt-1.5 text-[11px]">
          {t.overdue ? (
            <Badge tone="red">已超一审周期 {t.overdueDays} 天 · 建议询问编辑部</Badge>
          ) : (
            <Badge tone="amber">预计{t.estimatedStage ? STATUS_META[t.estimatedStage].label : ''}阶段 · 一审节点 {fmtDate(t.dueAt)}</Badge>
          )}
        </div>
      )}

      {/* 横向 Stepper：当前状态在链路中的位置（窄屏可横向滚动，避免 9 节点挤压换行） */}
      {stepIdx >= 0 && (
        <div className="mt-3 overflow-x-auto">
          <div className="flex items-center min-w-[620px]">
            {STEPPER_CHAIN.map((s, i) => (
              <div key={s} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      i <= stepIdx ? (i === stepIdx ? 'bg-teal-600 ring-4 ring-teal-100 dark:ring-teal-900/40' : 'bg-teal-400') : 'bg-slate-200 dark:bg-slate-700'
                    }`}
                  />
                  <span className={`text-[11px] mt-0.5 ${i === stepIdx ? 'text-teal-700 font-medium' : 'text-slate-400'}`}>{STATUS_META[s].label}</span>
                </div>
                {i < STEPPER_CHAIN.length - 1 && <div className={`h-px flex-1 mx-0.5 mb-3 ${i < stepIdx ? 'bg-teal-400' : 'bg-slate-200 dark:bg-slate-700'}`} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 追加状态事件 */}
      {props.eventOpen && (
        <div className="mt-3 rounded-lg border border-slate-100 dark:border-slate-800 p-3 space-y-2">
          <Select options={STATUS_OPTIONS} value={props.evStatus} onChange={(v) => props.onStatusChange(v as SubmissionStatus)} />
          <Input placeholder="备注（可选）" value={props.evNote} onChange={(e) => props.onNoteChange(e.target.value)} />
          {REVISION_STATUSES.has(props.evStatus) && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">修回截止日期</span>
              <Input type="date" value={props.evDeadline} onChange={(e) => props.onDeadlineChange(e.target.value)} />
            </div>
          )}
          <Button className="text-xs px-2 py-1" onClick={props.onConfirmEvent}>确认追加状态</Button>
        </div>
      )}

      {/* 粘贴邮件解析 */}
      {props.emailOpen && (
        <div className="mt-3 rounded-lg border border-slate-100 dark:border-slate-800 p-3 space-y-2">
          <Textarea rows={5} placeholder="粘贴编辑部邮件正文（退修/录用/退稿/缴费通知等），AI 给出建议状态，确认后入库" value={props.emailText} onChange={(e) => props.onEmailTextChange(e.target.value)} />
          <Button variant="outline" className="text-xs" disabled={props.parsing || !props.emailText.trim()} onClick={props.onParseEmail}>
            {props.parsing ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} AI 解析
          </Button>
          {props.parseResult && (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 dark:text-slate-400">建议状态：</span>
                <Badge tone={(STATUS_META[props.parseResult.suggestedStatus] || STATUS_META.submitted).tone}>
                  {(STATUS_META[props.parseResult.suggestedStatus] || STATUS_META.submitted).label}
                </Badge>
                <span className="text-[11px] text-slate-400">置信度 {Math.round(props.parseResult.confidence * 100)}%</span>
                {props.parseResult.date && <span className="text-[11px] text-slate-400">{props.parseResult.date}</span>}
              </div>
              {props.parseResult.reason && <div className="text-[11px] text-slate-500 dark:text-slate-400">依据：{props.parseResult.reason}</div>}
              <div className="flex gap-2 pt-1">
                <Button className="text-xs px-2 py-1" disabled={props.confirming} onClick={props.onConfirmParse}>
                  {props.confirming ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 确认更新
                </Button>
                <Button variant="outline" className="text-xs px-2 py-1" onClick={props.onDismissParse}>忽略建议</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 状态事件时间线 */}
      <button className="mt-2 text-[11px] text-slate-400 hover:text-slate-600" onClick={props.onToggleHistory}>
        {props.historyOpen ? '收起历史' : `展开历史（${t.events.length} 条）`}
      </button>
      {props.historyOpen && (
        <div className="mt-2 ml-1 border-l-2 border-slate-100 dark:border-slate-800 pl-3 space-y-2">
          {t.events.map((ev) => (
            <div key={ev.id} className="text-[12px]">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 dark:text-slate-500">{fmtDate(ev.eventAt)}</span>
                <Badge tone={(STATUS_META[ev.toStatus as SubmissionStatus] || STATUS_META.submitted).tone}>
                  {(STATUS_META[ev.toStatus as SubmissionStatus] || STATUS_META.submitted).label}
                </Badge>
                {ev.source === 'email_ai' && <span className="text-[11px] text-slate-400">AI 邮件解析</span>}
              </div>
              {ev.note && <div className="text-slate-500 dark:text-slate-400 mt-0.5">{ev.note}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
