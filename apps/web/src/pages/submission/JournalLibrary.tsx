import { Library, Plus, Trash2 } from 'lucide-react';
import type { Journal } from '../../types';
import { Badge, Button, Card, Input } from '../../components/ui';

export type JournalLibraryForm = { name: string; issn: string; publisher: string; quartile: string; if2024: string };

type Props = {
  journals: Journal[];
  form: JournalLibraryForm;
  onFormChange: (patch: Partial<JournalLibraryForm>) => void;
  onAdd: () => void;
  onRemove: (journal: Journal) => void;
};

/** 我的期刊库：录入表单 + 已收录列表。 */
export function JournalLibrary({ journals, form, onFormChange, onAdd, onRemove }: Props) {
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Library size={15} className="text-teal-600" />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">我的期刊库</span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">已收录 {journals.length} 本</span>
      </div>
      <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-2">
        <Input placeholder="期刊名（必填）" value={form.name} onChange={(e) => onFormChange({ name: e.target.value })} />
        <Input placeholder="ISSN（可选）" value={form.issn} onChange={(e) => onFormChange({ issn: e.target.value })} />
        <Input placeholder="出版商（可选）" value={form.publisher} onChange={(e) => onFormChange({ publisher: e.target.value })} />
        <Input placeholder="分区 如 Q1（可选）" value={form.quartile} onChange={(e) => onFormChange({ quartile: e.target.value })} />
        <Input placeholder="IF 2024（可选）" value={form.if2024} onChange={(e) => onFormChange({ if2024: e.target.value })} />
      </div>
      <Button variant="outline" className="text-xs mb-3" disabled={!form.name.trim()} onClick={onAdd}>
        <Plus size={13} /> 添加到期刊库
      </Button>
      {journals.length === 0 ? (
        <div className="text-xs text-slate-400 dark:text-slate-500">
          期刊库为空 —— 添加常投期刊后，上方匹配结果会自动标记「已在期刊库」
        </div>
      ) : (
        <div className="space-y-1.5">
          {journals.map((j) => (
            <div key={j.id} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200 flex-1 min-w-0 truncate">{j.name}</span>
              {j.if2024 ? <Badge tone="teal">IF {j.if2024}</Badge> : null}
              {j.quartile ? <Badge tone="slate">{j.quartile}</Badge> : null}
              {j.firstDecisionWeeks ? <span className="text-[11px] text-slate-400 dark:text-slate-500">{j.firstDecisionWeeks} 周一审</span> : null}
              <button className="p-1 text-slate-400 hover:text-rose-500 shrink-0" title="移除期刊" aria-label={`移除期刊 ${j.name}`} onClick={() => onRemove(j)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
