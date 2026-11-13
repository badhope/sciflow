import { useContext, useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { api } from '../../api/client';
import { ToastContext } from '../../App';
import { Badge, Button, Card, SectionTitle, Spinner, errMsg } from '../../components/ui';

/**
 * Agent 权限档（AI 能读什么、能改什么）。
 *
 * 产品约束：AI 默认不得修改系统级配置（模型 Key、权限档、扩展、钩子），
 * 也不得触碰程序自身的目录与文件；只有用户显式选择「最大权限」才放开，
 * 且写入仍走逐次审批。这里把该边界做成可见、可控、可回退的选择项。
 */

const ICONS: Record<string, typeof ShieldCheck> = {
  strict: ShieldOff,
  workspace: ShieldCheck,
  full: ShieldAlert,
};

export function AgentAccessSettings() {
  const toast = useContext(ToastContext);
  const [mode, setMode] = useState('');
  const [modes, setModes] = useState<{ value: string; label: string; description: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.settings
      .getAgentAccess()
      .then((r) => {
        if (cancelled) return;
        setMode(r.mode);
        setModes(r.modes);
        setError('');
      })
      .catch((e: unknown) => { if (!cancelled) setError(errMsg(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const choose = async (next: string) => {
    if (next === mode) return;
    setSaving(next);
    try {
      const r = await api.settings.setAgentAccess(next);
      setMode(r.mode);
      setModes(r.modes);
      toast('success', `AI 权限档已切换为「${r.modes.find((m) => m.value === r.mode)?.label || r.mode}」`);
    } catch (e: unknown) {
      toast('error', errMsg(e));
    } finally {
      setSaving('');
    }
  };

  return (
    <Card className="p-5">
      <SectionTitle>
        <span className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-teal-600" /> AI 权限档
        </span>
      </SectionTitle>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        控制 AI 与内置工具能读什么、能改什么。默认只允许在项目内工作；系统配置、扩展与程序自身文件需要显式放开。
      </p>
      {error ? <div className="mb-3 rounded bg-rose-50 p-2 text-xs text-rose-600 dark:bg-rose-900/20 dark:text-rose-300">{error}</div> : null}
      {loading ? (
        <Spinner label="加载权限档" />
      ) : (
        <div className="space-y-2">
          {modes.map((m) => {
            const Icon = ICONS[m.value] || ShieldCheck;
            const active = m.value === mode;
            return (
              <div
                key={m.value}
                className={`flex flex-wrap items-start gap-3 rounded-lg border p-3 ${
                  active ? 'border-teal-400 bg-teal-50/60 dark:border-teal-600 dark:bg-teal-500/10' : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <Icon size={16} className={active ? 'mt-0.5 text-teal-600' : 'mt-0.5 text-slate-400'} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{m.label}</span>
                    {active ? <Badge tone="green">当前</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{m.description}</p>
                </div>
                <Button
                  size="xs"
                  variant={active ? 'outline' : 'primary'}
                  disabled={active || Boolean(saving)}
                  loading={saving === m.value}
                  onClick={() => void choose(m.value)}
                >
                  {active ? '已启用' : '切换到此档'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
        「最大权限」下写系统配置（模型、权限档、扩展、钩子）仍需逐次人工或 AI 专家审批；程序自身文件与数据库始终不可由 AI 改写。
      </p>
    </Card>
  );
}
