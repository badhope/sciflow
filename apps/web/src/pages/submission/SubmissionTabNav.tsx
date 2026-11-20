import type { LucideIcon } from 'lucide-react';
import { CalendarClock, ClipboardCheck, FilePen, Globe2, MessageSquareReply } from 'lucide-react';
import type { SubmissionTab } from './status';

const TABS: { key: SubmissionTab; label: string; icon: LucideIcon }[] = [
  { key: 'readiness', label: '就绪检查', icon: ClipboardCheck },
  { key: 'journals', label: '期刊推荐', icon: Globe2 },
  { key: 'cover', label: 'Cover Letter', icon: FilePen },
  { key: 'reply', label: '审稿回复', icon: MessageSquareReply },
  { key: 'track', label: '投稿跟踪', icon: CalendarClock },
];

type Props = {
  tab: SubmissionTab;
  onChange: (tab: SubmissionTab) => void;
};

/** 投稿辅助页顶部 Tab 导航，保持旧深链与 Tab 行为不变。 */
export function SubmissionTabNav({ tab, onChange }: Props) {
  return (
    <div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap shrink-0 ${
            tab === t.key ? 'border-teal-600 text-teal-700 font-medium' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800'
          }`}
        >
          <t.icon size={14} /> {t.label}
        </button>
      ))}
    </div>
  );
}
