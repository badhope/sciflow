import { useContext, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, Plus, RotateCcw, Save, Sparkles, Trash2, Zap } from 'lucide-react';
import { api } from '../../api/client';
import type { PersonaSkill } from '../../types';
import { Badge, Button, Card, Input, SectionTitle, Textarea, errMsg } from '../../components/ui';
import { ToastContext } from '../../App';

/** 角色与技能（对标 Dify/Coze 人设管理）：自定义系统提示词 + 技能启停 + 自定义技能 */
export function PersonaSettings() {
  const toast = useContext(ToastContext);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [skills, setSkills] = useState<PersonaSkill[]>([]);
  const [showBuiltinPrompt, setShowBuiltinPrompt] = useState(false);

  // 新增自定义技能表单
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.settings
      .getPersona()
      .then((p) => {
        if (cancelled) return;
        setName(p.name ?? '');
        setSystemPrompt(p.systemPrompt ?? '');
        setSkills(p.skills ?? []);
      })
      .catch(() => toast('error', '读取角色配置失败'))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const builtinSkills = useMemo(() => skills.filter((s) => s.builtin === 1), [skills]);
  const customSkills = useMemo(() => skills.filter((s) => s.builtin === 0), [skills]);

  const toggleSkill = (id: string) =>
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: s.enabled === 0 ? 1 : 0 } : s)));

  const removeSkill = (id: string) => setSkills((prev) => prev.filter((s) => s.id !== id));

  const addCustomSkill = () => {
    if (!newName.trim() || !newDesc.trim()) {
      toast('error', '技能名称与描述不能为空');
      return;
    }
    if (skills.some((s) => s.key === newKey.trim().toLowerCase() || (newKey.trim() && s.name === newName.trim()))) {
      toast('error', '技能 key 或名称已存在');
      return;
    }
    setSkills((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        key: newKey.trim().toLowerCase() || newName.trim().toLowerCase().replace(/\s+/g, '_'),
        name: newName.trim(),
        description: newDesc.trim(),
        enabled: 1,
        builtin: 0,
      },
    ]);
    setNewKey('');
    setNewName('');
    setNewDesc('');
    toast('success', '已添加自定义技能，记得保存');
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.settings.savePersona({ name, systemPrompt, skills });
      setSkills(res.skills ?? skills);
      toast('success', '角色与技能已保存，新对话立即生效');
    } catch (e: unknown) {
      toast('error', errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const resetPrompt = () => {
    setSystemPrompt('');
    toast('success', '已恢复内置角色（留空即使用默认系统提示词）');
  };

  return (
    <Card className="p-4 mb-4" id="settings-persona">
      <SectionTitle
        extra={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={resetPrompt} disabled={!systemPrompt.trim()}>
              <RotateCcw size={13} /> 恢复内置角色
            </Button>
            <Button onClick={save} disabled={saving || !loaded}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 保存
            </Button>
          </div>
        }
      >
        <span className="flex items-center gap-2">
          <Sparkles size={16} className="text-teal-600" /> 角色与技能
        </span>
      </SectionTitle>

      {!loaded ? (
        <div className="py-8 text-center text-sm text-slate-400"><Loader2 size={16} className="animate-spin inline-block mr-1.5" /> 加载角色配置…</div>
      ) : (
        <div className="space-y-5">
          {/* 角色名称 */}
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">角色名称（可选，如「严谨的科研导师」）</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="留空使用默认角色名称"
              className="max-w-md"
            />
          </div>

          {/* 系统提示词 */}
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              系统提示词（角色定义）<span className="text-slate-400 font-normal"> — 留空则使用内置角色「SciFlow 全自动 AI 科研助手」</span>
            </label>
            <Textarea
              rows={9}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="在这里定义助手的人设、行为边界与输出风格…（可包含：角色定位 / 回答风格 / 必须遵守的规则 / 输出格式要求）"
              className="font-mono text-[13px]"
            />
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowBuiltinPrompt((v) => !v)}
                className="text-[11px] text-teal-600 dark:text-teal-400 flex items-center gap-1 hover:underline"
              >
                <ChevronDown size={12} className={`transition-transform ${showBuiltinPrompt ? 'rotate-180' : ''}`} />
                查看内置默认提示词
              </button>
              <span className="text-[11px] text-slate-400">自定义后替代内置角色段，项目偏好/记忆/知识库上下文照常注入</span>
            </div>
            {showBuiltinPrompt && (
              <pre className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 p-3 text-[11px] text-slate-500 dark:text-slate-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
                {systemPrompt.trim() ? systemPrompt.trim() : '（当前使用内置默认提示词）'}
              </pre>
            )}
          </div>

          {/* 技能列表 */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">技能（Skills）</label>
              <Badge tone="slate">{skills.length} 个</Badge>
              <span className="text-[11px] text-slate-400">启用的技能会注入每轮对话上下文，助手按需使用对应能力</span>
            </div>

            {/* 内置技能 */}
            <div className="space-y-2">
              {builtinSkills.map((s) => (
                <SkillRow key={s.id} skill={s} onToggle={toggleSkill} onRemove={undefined} />
              ))}
            </div>

            {/* 自定义技能 */}
            {customSkills.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">自定义技能</div>
                {customSkills.map((s) => (
                  <SkillRow key={s.id} skill={s} onToggle={toggleSkill} onRemove={removeSkill} />
                ))}
              </div>
            )}

            {/* 新增自定义技能 */}
            <div className="mt-3 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-3">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                <Plus size={13} className="text-teal-600" /> 新增自定义技能
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
                <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="key（英文，可空自动生成）" className="text-[12px]" />
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="名称，如：代码审查" className="text-[12px]" />
                <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="一句话描述该技能的能力…" className="text-[12px]" />
                <Button variant="outline" onClick={addCustomSkill}>
                  <Plus size={13} /> 添加
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function SkillRow({ skill, onToggle, onRemove }: { skill: PersonaSkill; onToggle: (id: string) => void; onRemove?: (id: string) => void }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${skill.enabled === 1 ? 'border-teal-200 dark:border-teal-800/60 bg-teal-50/50 dark:bg-teal-900/10' : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30 opacity-80'}`}>
      <span className={`flex h-2 w-2 shrink-0 rounded-full ${skill.enabled === 1 ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{skill.name}</span>
          <Badge tone={skill.builtin === 1 ? 'teal' : 'slate'}>{skill.builtin === 1 ? '内置' : '自定义'}</Badge>
          {skill.enabled === 1 && (
            <span className="text-[10px] text-teal-600 dark:text-teal-400 flex items-center gap-0.5"><Zap size={10} /> 已启用</span>
          )}
        </div>
        <p className="text-[12px] text-slate-400 dark:text-slate-500 truncate">{skill.description}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => onToggle(skill.id)}
          role="switch"
          aria-checked={skill.enabled === 1}
          className={`relative h-5 w-9 rounded-full transition-colors ${skill.enabled === 1 ? 'bg-teal-500' : 'bg-slate-200 dark:bg-slate-700'}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${skill.enabled === 1 ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(skill.id)}
            className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
            title="删除技能"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
