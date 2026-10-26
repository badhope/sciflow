/**
 * 配置中心 CLI 命令注册（从 cli.ts 拆出，避免主入口继续膨胀）。
 *
 * 与 Web 设置页、对话工具共用同一 REST 服务（三者互相可见）：
 * `sciflow config status|permission|role|constraint|hook|preset|preview|audit`
 */
import type { Command } from 'commander';

type Api = (path: string, opts?: { method?: string; body?: unknown }) => Promise<any>;

export function registerConfigCommands(program: Command, localApi: Api): void {
  const config = program.command('config').description('配置中心（角色/约束/钩子/权限/预设/审计）');

  config
    .command('status')
    .description('查看配置快照（权限档/角色/约束/钩子/预设）')
    .option('--json', '输出完整 JSON')
    .action(async (opts: { json?: boolean }) => {
      const snap = await localApi('/api/config');
      if (opts.json) {
        console.log(JSON.stringify(snap, null, 2));
        return;
      }
      const perm = snap.permission;
      console.log(`权限档：${perm.mode}（${perm.modes.find((m: any) => m.value === perm.mode)?.label ?? ''}）`);
      console.log(`核心保护项：${perm.coreProtected.map((c: any) => c.label).join('、')}`);
      console.log(`\n角色（${snap.roles.length}）：`);
      console.table(snap.roles.map((r: any) => ({ id: r.id.slice(0, 8), name: r.name, default: r.isDefault === 1, enabled: r.enabled })));
      console.log(`\n约束（${snap.constraints.length}）：`);
      console.table(snap.constraints.map((c: any) => ({ id: c.id.slice(0, 8), title: c.title, level: c.level, scope: c.scope, enabled: c.enabled, source: c.source })));
      console.log(`\n钩子（${snap.hooks.length}）：`);
      console.table(snap.hooks.map((h: any) => ({ id: h.id.slice(0, 8), name: h.name, event: h.event, type: h.type, enabled: h.enabled })));
      console.log(`\n预设：${snap.presets.map((p: any) => p.id).join(' / ')}`);
    });

  config
    .command('permission')
    .description('查看或切换权限档（strict / balanced / open / unrestricted）')
    .argument('[mode]', '目标档位；省略则只查看')
    .action(async (mode?: string) => {
      if (!mode) {
        console.log(JSON.stringify(await localApi('/api/config/permission'), null, 2));
        return;
      }
      const info = await localApi('/api/config/permission', { method: 'POST', body: { mode } });
      console.log(`权限档已切换为：${info.mode}`);
    });

  config
    .command('role')
    .description('角色管理：list / add / default / delete')
    .argument('<action>', 'list|add|default|delete')
    .argument('[arg1]', 'add: 名称；default|delete: 角色 ID 或名称')
    .option('--prompt <text>', 'add: 系统提示词')
    .option('--prompt-file <path>', 'add: 从文件读取系统提示词')
    .action(async (action: string, arg1: string | undefined, opts: { prompt?: string; promptFile?: string }) => {
      if (action === 'list') {
        const roles = await localApi('/api/config/roles');
        console.table(roles.map((r: any) => ({ id: r.id.slice(0, 8), name: r.name, default: r.isDefault === 1, enabled: r.enabled, promptLen: r.systemPrompt.length })));
        return;
      }
      if (action === 'add') {
        if (!arg1) throw new Error('add 需要角色名称');
        let prompt = opts.prompt || '';
        if (opts.promptFile) {
          const { readFileSync } = await import('node:fs');
          prompt = readFileSync(opts.promptFile, 'utf-8');
        }
        await localApi('/api/config/roles', { method: 'POST', body: { name: arg1, systemPrompt: prompt, isDefault: true } });
        console.log(`角色「${arg1}」已创建并设为默认`);
        return;
      }
      const roles = await localApi('/api/config/roles');
      const target = roles.find((r: any) => r.id === arg1 || r.id.startsWith(String(arg1)) || r.name === arg1);
      if (!target) throw new Error(`找不到角色：${arg1}`);
      if (action === 'default') {
        await localApi(`/api/config/roles/${target.id}`, { method: 'POST', body: { isDefault: true } });
        console.log(`已把「${target.name}」设为默认角色`);
        return;
      }
      if (action === 'delete') {
        await localApi(`/api/config/roles/${target.id}`, { method: 'DELETE' });
        console.log(`角色「${target.name}」已删除`);
        return;
      }
      throw new Error(`未知动作：${action}（支持 list|add|default|delete）`);
    });

  config
    .command('constraint')
    .description('约束管理：list / add / enable / disable / delete')
    .argument('<action>', 'list|add|enable|disable|delete')
    .argument('[arg1]', 'add: 标题；enable|disable|delete: 约束 ID 或标题')
    .option('--rule <text>', 'add: 规则内容')
    .option('--level <level>', 'add: must|must_not|should', 'must')
    .option('--scope <scope>', 'add: all|chat|pipeline', 'all')
    .action(async (action: string, arg1: string | undefined, opts: { rule?: string; level: string; scope: string }) => {
      if (action === 'list') {
        const list = await localApi('/api/config/constraints');
        console.table(list.map((c: any) => ({ id: c.id.slice(0, 8), title: c.title, level: c.level, scope: c.scope, enabled: c.enabled, rule: c.rule.slice(0, 40) })));
        return;
      }
      if (action === 'add') {
        if (!arg1 || !opts.rule) throw new Error('add 需要标题与 --rule');
        await localApi('/api/config/constraints', { method: 'POST', body: { title: arg1, rule: opts.rule, level: opts.level, scope: opts.scope } });
        console.log(`约束「${arg1}」已创建（下一次 AI 调用生效）`);
        return;
      }
      const list = await localApi('/api/config/constraints');
      const target = list.find((c: any) => c.id === arg1 || c.id.startsWith(String(arg1)) || c.title === arg1);
      if (!target) throw new Error(`找不到约束：${arg1}`);
      if (action === 'enable' || action === 'disable') {
        await localApi(`/api/config/constraints/${target.id}`, { method: 'POST', body: { enabled: action === 'enable' ? 1 : 0 } });
        console.log(`约束「${target.title}」已${action === 'enable' ? '启用' : '停用'}`);
        return;
      }
      if (action === 'delete') {
        await localApi(`/api/config/constraints/${target.id}`, { method: 'DELETE' });
        console.log(`约束「${target.title}」已删除`);
        return;
      }
      throw new Error(`未知动作：${action}`);
    });

  config
    .command('hook')
    .description('钩子管理：list / add / enable / disable / delete')
    .argument('<action>', 'list|add|enable|disable|delete')
    .argument('[arg1]', 'add: 名称；enable|disable|delete: 钩子 ID 或名称')
    .option('--event <event>', 'add: chat:before|chat:after|pipeline:before|pipeline:after', 'chat:before')
    .option('--type <type>', 'add: prompt_inject|block|webhook', 'prompt_inject')
    .option('--config <json>', 'add: JSON 配置', '{"text":""}')
    .action(async (action: string, arg1: string | undefined, opts: { event: string; type: string; config: string }) => {
      if (action === 'list') {
        const list = await localApi('/api/config/hooks');
        console.table(list.map((h: any) => ({ id: h.id.slice(0, 8), name: h.name, event: h.event, type: h.type, enabled: h.enabled, config: h.config.slice(0, 40) })));
        return;
      }
      if (action === 'add') {
        if (!arg1) throw new Error('add 需要钩子名称');
        await localApi('/api/config/hooks', { method: 'POST', body: { name: arg1, event: opts.event, type: opts.type, config: opts.config } });
        console.log(`钩子「${arg1}」已创建（下一轮对话/流水线执行）`);
        return;
      }
      const list = await localApi('/api/config/hooks');
      const target = list.find((h: any) => h.id === arg1 || h.id.startsWith(String(arg1)) || h.name === arg1);
      if (!target) throw new Error(`找不到钩子：${arg1}`);
      if (action === 'enable' || action === 'disable') {
        await localApi(`/api/config/hooks/${target.id}`, { method: 'POST', body: { enabled: action === 'enable' ? 1 : 0 } });
        console.log(`钩子「${target.name}」已${action === 'enable' ? '启用' : '停用'}`);
        return;
      }
      if (action === 'delete') {
        await localApi(`/api/config/hooks/${target.id}`, { method: 'DELETE' });
        console.log(`钩子「${target.name}」已删除`);
        return;
      }
      throw new Error(`未知动作：${action}`);
    });

  config
    .command('preset')
    .description('应用内置预设：academic-rigor | fast-output | reviewer-strict | data-careful')
    .argument('<presetId>', '预设 ID')
    .action(async (presetId: string) => {
      const snap = await localApi(`/api/config/presets/${presetId}/apply`, { method: 'POST' });
      console.log(`已应用预设 ${presetId}：角色 ${snap.roles.length} / 约束 ${snap.constraints.length} / 钩子 ${snap.hooks.length}`);
    });

  config
    .command('preview')
    .description('预览当前约束与钩子实际注入的文本')
    .option('--scope <scope>', 'chat | pipeline', 'chat')
    .action(async (opts: { scope: string }) => {
      const r = await localApi(`/api/config/preview?scope=${opts.scope}`);
      console.log(`# 默认角色：${r.role?.name ?? '（内置默认）'}`);
      console.log(r.text || '（无约束与 prompt_inject 钩子）');
    });

  config
    .command('audit')
    .description('查看配置审计（含被拒的操作与原因）')
    .option('--limit <n>', '条数', '50')
    .action(async (opts: { limit: string }) => {
      const rows = await localApi(`/api/config/audit?limit=${Number(opts.limit) || 50}`);
      console.table(rows.map((a: any) => ({
        at: new Date(a.createdAt).toLocaleString('zh-CN'),
        actor: a.actor, category: a.category, action: a.action,
        allowed: a.allowed === 1, reason: a.reason,
      })));
    });
}
