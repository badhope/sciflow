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
    .command('export')
    .description('导出配置包（角色/约束/钩子/权限）到 stdout 或文件')
    .option('--out <path>', '写入文件（缺省打印到 stdout）')
    .action(async (opts: { out?: string }) => {
      const bundle = await localApi('/api/config/export');
      const text = JSON.stringify(bundle, null, 2);
      if (opts.out) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(opts.out, text, 'utf-8');
        console.log(`配置包已写入 ${opts.out}`);
      } else {
        console.log(text);
      }
    });

  config
    .command('import')
    .description('从 JSON 文件导入配置包（--merge 默认追加；--replace 覆盖用户自建项）')
    .argument('<file>', '配置包 JSON 路径')
    .option('--replace', '覆盖模式（清空用户自建约束/钩子后写入）', false)
    .action(async (file: string, opts: { replace?: boolean }) => {
      const { readFileSync } = await import('node:fs');
      const bundle = JSON.parse(readFileSync(file, 'utf-8'));
      const r = await localApi('/api/config/import', { method: 'POST', body: { bundle, merge: opts.replace !== true } });
      console.log(`导入完成：角色 ${r.rolesAdded} / 约束 ${r.constraintsAdded} / 钩子 ${r.hooksAdded}`);
      if (r.errors?.length) console.log(`跳过 ${r.errors.length} 条：${r.errors.map((e: string) => `\n  - ${e}`).join('')}`);
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


/** 扩展中心 CLI（v1.4）：与设置页/对话工具同源，写操作带 X-Sciflow-Actor: cli 审计来源 */
export function registerExtensionCommands(program: Command, localApi: Api): void {
  const ext = program.command('ext').description('扩展中心（技能/MCP/角色/约束/钩子/提示词）');

  ext
    .command('list')
    .description('列出扩展资产（含内置与私有标记）')
    .option('--kind <kind>', 'skill|mcp|role|constraint|hook|prompt')
    .action(async (opts: { kind?: string }) => {
      const q = opts.kind ? `?kind=${opts.kind}` : '';
      const r = await localApi(`/api/extensions${q}`);
      console.table((r.assets || []).map((a: any) => ({
        key: a.key, kind: a.kind, name: a.name, source: a.source,
        visibility: a.visibility, enabled: a.enabled === 1,
      })));
      console.log(`共 ${r.assets?.length ?? 0} 条`);
    });

  ext
    .command('toggle')
    .description('启用/停用一条扩展（按 key）')
    .argument('<key>', '资产 key')
    .option('--off', '停用（默认启用）', false)
    .action(async (key: string, opts: { off?: boolean }) => {
      const all = await localApi('/api/extensions');
      const row = (all.assets || []).find((a: any) => a.key === key);
      if (!row) throw new Error(`未找到扩展：${key}`);
      const next = await localApi(`/api/extensions/${row.id}/toggle`, { method: 'POST', body: { enabled: opts.off !== true } });
      console.log(`${next.name} 已${next.enabled ? '启用' : '停用'}`);
    });

  ext
    .command('import')
    .description('导入 SKILL.md / 模板 JSON / MCP JSON 文件（.md/.json；压缩包请在设置页拖拽或先解压）')
    .argument('<file>', '文件路径')
    .action(async (file: string) => {
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(file, 'utf-8');
      const r = await localApi('/api/extensions/import', { method: 'POST', body: { filename: file, content } });
      console.log(`导入完成：新增 ${r.added} / 更新 ${r.updated}`);
      if (r.errors?.length) console.log(`跳过 ${r.errors.length} 条：${r.errors.map((e: string) => `
  - ${e}`).join('')}`);
    });

  ext
    .command('export')
    .description('导出扩展包（不含 SciFlow 私有优势工具）')
    .option('--out <path>', '写入文件（缺省 stdout）')
    .action(async (opts: { out?: string }) => {
      const bundle = await localApi('/api/extensions/export');
      const text = JSON.stringify(bundle, null, 2);
      if (opts.out) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(opts.out, text, 'utf-8');
        console.log(`已写入 ${opts.out}（${bundle.assets.length} 条）`);
      } else console.log(text);
    });

  ext
    .command('reset')
    .description('恢复全部内置资产（重新启用）')
    .action(async () => {
      const r = await localApi('/api/extensions/reset-builtin', { method: 'POST' });
      console.log(`已恢复 ${r.restored} 条内置资产`);
    });
}


/** 客观质量检查 CLI：docs quality --doc <id> / --file <path> */
export function registerQualityCommands(program: Command, localApi: Api): void {
  const q = program.command('quality').description('客观质量检查（确定性规则引擎，不调模型）');

  q
    .command('check')
    .description('检查一篇文档：六维硬指标 + 硬伤 + 指纹（同文本分数恒定）')
    .option('--doc <id>', '文档 ID（读库）')
    .option('--file <path>', '本地 Markdown 文件（离线检查）')
    .option('--citations <n>', '已知的参考文献条数（离线检查纯正文且列表不在正文时用，避免误判「无参考文献」硬伤）')
    .option('--json', '输出完整 JSON')
    .action(async (opts: { doc?: string; file?: string; citations?: string; json?: boolean }) => {
      let report: any;
      if (opts.file) {
        const { readFileSync } = await import('node:fs');
        const { checkPaperQuality } = await import('../common/quality-audit');
        const content = readFileSync(opts.file, 'utf-8');
        // 纯正文（列表由前端/导出渲染）文件：正文只有 [n] 锚点时不能据此判「无参考文献」硬伤。
        // 默认按 externalRefs 处理（引用维度按锚点计 8/20 并说明原因）；给了 --citations N 才逐条核对总数。
        const citationCount = opts.citations !== undefined ? Math.max(0, Number(opts.citations) || 0) : undefined;
        report = { documentId: null, title: opts.file, report: checkPaperQuality(content, { citationCount, externalRefs: citationCount === undefined }), llmHistory: [] };
      } else if (opts.doc) {
        report = await localApi(`/api/documents/${opts.doc}/objective-audit`);
      } else {
        throw new Error('需要 --doc <id> 或 --file <path>');
      }
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      const r = report.report;
      console.log(`# ${report.title ?? report.documentId}`);
      console.log(`总分：${r.totalScore}/100  指纹：${r.fingerprint}`);
      console.log(`统计：${r.stats.chars} 字符 / ${r.stats.sections} 章节 / ${r.stats.uniqueCitations} 引用 / ${r.stats.referenceEntries} 文献条目`);
      console.table(r.dimensions.map((d: any) => ({ 维度: d.label, 得分: `${d.score}/20`, 证据: d.evidence.join('；').slice(0, 80) })));
      if (r.hardFails.length) {
        console.log('硬伤：');
        r.hardFails.forEach((f: string) => console.log(`  - ${f}`));
      }
    });
}
