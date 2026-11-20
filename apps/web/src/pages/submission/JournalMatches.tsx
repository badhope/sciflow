import { Send } from 'lucide-react';
import type { JournalMatchItem, JournalMatchResult } from '../../types';
import { Badge, Card, Spinner } from '../../components/ui';
import { HBar } from '../../components/charts';

type Props = {
  matching: boolean;
  match: JournalMatchResult | null;
  onPickJournal: (journal: JournalMatchItem) => void;
};

/** 期刊推荐结果：匹配中 / 结果列表 / 空结果三态。 */
export function JournalMatches({ matching, match, onPickJournal }: Props) {
  if (matching) {
    return (
      <Card className="p-4 mb-4">
        <Spinner label="AI 结构化匹配期刊中…" />
      </Card>
    );
  }
  if (!match) return null;
  if (match.journals.length === 0) {
    return (
      <Card className="p-4 mb-4 text-center text-slate-400 dark:text-slate-500 text-sm">未匹配到合适期刊，补充摘要后重试</Card>
    );
  }
  return (
    <Card className="p-4 mb-4">
      <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">推荐期刊（按匹配度排序）</div>
      <div className="space-y-3">
        {[...match.journals]
          .sort((a, b) => b.score - a.score)
          .map((j) => {
            const meta = [
              j.if2024 ? `IF ${j.if2024}` : '',
              j.quartile || '',
              j.firstDecisionWeeks ? `${j.firstDecisionWeeks} 周一审` : '',
              j.acceptanceRate ? `录用率 ${j.acceptanceRate}%` : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <div key={j.name} className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{j.name}</span>
                  {j.isInLibrary && <Badge tone="green">已在期刊库</Badge>}
                  {j.oa && <Badge tone="slate">{j.oa === 'yes' ? 'OA' : j.oa}</Badge>}
                </div>
                <HBar
                  max={100}
                  items={[
                    {
                      label: '匹配度',
                      value: j.score,
                      sub: meta,
                      hint: `${j.name}：匹配度 ${j.score}/100${meta ? ` · ${meta}` : ''}`,
                    },
                  ]}
                />
                {(j.reason || j.gap) && (
                  <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                    {j.reason && (
                      <div>
                        <span className="text-slate-400 dark:text-slate-500">推荐理由：</span>
                        {j.reason}
                      </div>
                    )}
                    {j.gap && (
                      <div>
                        <span className="text-slate-400 dark:text-slate-500">差距提示：</span>
                        {j.gap}
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => onPickJournal(j)}
                    className="inline-flex items-center gap-1 text-xs rounded-md bubble-user px-2.5 py-1 hover:brightness-110"
                    title="把这本期刊带入「投稿跟踪」登记表单"
                  >
                    <Send size={12} /> 投它
                  </button>
                  {!j.isInLibrary && (
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">未入期刊库，登记时可手动补录以获取一审周期</span>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </Card>
  );
}
