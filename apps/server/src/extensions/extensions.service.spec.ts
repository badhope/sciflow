import { beforeEach, describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { sqlite } from '../db/database';
import { ExtensionsService, assetKey, parseFrontmatter, parseMcpJson, parseSkillMarkdown, parseTemplateJson } from './extensions.service';
import { ConfigCenterService } from '../config/config-center.service';
import type { AiService } from '../ai/ai.service';

/**
 * 扩展中心契约（v1.4）：
 * - 内置目录随启动幂等播种（≈87 条，public/private 两类），默认全启用
 * - 启用/停用真实投影到各子系统（技能→app_setting.skills、约束/钩子/角色/提示词/MCP）
 * - 私有优势工具不进导出包
 * - 四种导入格式（SKILL.md / 模板 JSON / MCP JSON / ZIP）与错误定位
 */

function fakeAi(overrides: Partial<Record<string, unknown>> = {}): AiService {
  return {
    configured: true,
    complete: async () => JSON.stringify({ kind: 'skill', name: 'AI 生成技能', description: '由 AI 生成', manifest: { mode: 'prompt', instructions: '按步骤执行' } }),
    getCustomPrompt: () => null,
    ...overrides,
  } as unknown as AiService;
}

function clean() {
  sqlite.prepare('DELETE FROM extension_asset').run();
  sqlite.prepare("DELETE FROM app_setting WHERE key = 'extension_prompt_active'").run();
}

describe('解析器', () => {
  it('SKILL.md frontmatter + 正文', () => {
    const md = '---\nname: lit-matrix\ndescription: 精读矩阵\n---\n\n# 步骤\n1. 读摘要\n';
    const { meta, body } = parseFrontmatter(md);
    expect(meta.name).toBe('lit-matrix');
    expect(body).toContain('读摘要');
    const asset = parseSkillMarkdown(md, 'fallback');
    expect(asset.kind).toBe('skill');
    expect(asset.key).toBe('skill-lit-matrix');
    expect(String(asset.manifest.instructions)).toContain('读摘要');
  });

  it('无 frontmatter 时按首行兜底，不崩', () => {
    const asset = parseSkillMarkdown('# 标题\n正文', 'x');
    expect(asset.name).toBe('x');
    expect(asset.description).toContain('标题');
  });

  it('MCP JSON：只接受 http(s) 端点，stdio 明确报错', () => {
    const ok = parseMcpJson({ mcpServers: { demo: { url: 'https://x.example/mcp', description: 'd' } } });
    expect(ok[0]).toMatchObject({ kind: 'mcp', key: 'mcp-demo' });
    expect(() => parseMcpJson({ mcpServers: { local: { command: 'uvx x' } } })).toThrow(/HTTP/);
    expect(() => parseMcpJson({})).toThrow(/mcpServers/);
  });

  it('模板 JSON：kind 必填且非法 kind 报错带可选值', () => {
    expect(() => parseTemplateJson({ kind: 'bad', name: 'x' })).toThrow(/未知 kind/);
    expect(() => parseTemplateJson({ kind: 'skill' })).toThrow(/name/);
    const [a] = parseTemplateJson({ kind: 'constraint', name: '带单位', manifest: { title: '带单位', rule: '必须带单位', level: 'must', scope: 'all' } });
    expect(a.kind).toBe('constraint');
  });
});

describe('扩展中心服务', () => {
  let svc: ExtensionsService;
  beforeEach(() => {
    clean();
    svc = new ExtensionsService(fakeAi(), new ConfigCenterService());
  });

  it('首次播种：内置资产全启用，含 public 与 private', () => {
    const rows = svc.list();
    expect(rows.length).toBeGreaterThanOrEqual(80);
    expect(rows.every((r) => r.enabled === 1)).toBe(true);
    expect(rows.some((r) => r.visibility === 'private')).toBe(true);
    expect(rows.some((r) => r.source === 'builtin-public')).toBe(true);
    const kinds = new Set(rows.map((r) => r.kind));
    for (const k of ['skill', 'mcp', 'role', 'constraint', 'hook', 'prompt']) expect(kinds.has(k as never), k).toBe(true);
  });

  it('导出包排除 private 私有优势工具', () => {
    const bundle = svc.exportBundle();
    expect(bundle.assets.length).toBe(svc.listPublic().length);
    expect(bundle.assets.some((a) => String(a.key).startsWith('sci-'))).toBe(false);
    expect(bundle.assets.some((a) => a.visibility === 'private')).toBe(false);
  });

  it('播种后投影：技能进 app_setting.skills 且保留内置 4 项；约束/钩子/角色/MCP/提示词落库', () => {
    const skills = JSON.parse((sqlite.prepare("SELECT value FROM app_setting WHERE key='skills'").get() as { value: string }).value) as { key: string }[];
    for (const k of ['literature_search', 'knowledge_qa', 'writing_assist', 'web_research']) {
      expect(skills.some((s) => s.key === k), k).toBe(true);
    }
    expect(skills.some((s) => s.key.startsWith('skill-'))).toBe(true);
    expect((sqlite.prepare("SELECT COUNT(*) c FROM config_role WHERE name='方法学家'").get() as { c: number }).c).toBe(1);
    expect((sqlite.prepare("SELECT COUNT(*) c FROM config_constraint WHERE source='extension'").get() as { c: number }).c).toBeGreaterThanOrEqual(8);
    expect((sqlite.prepare("SELECT COUNT(*) c FROM config_hook").get() as { c: number }).c).toBeGreaterThanOrEqual(4);
    expect((sqlite.prepare("SELECT COUNT(*) c FROM mcp_server").get() as { c: number }).c).toBeGreaterThanOrEqual(2);
  });

  it('停用资产会撤回投影（技能 disabled / 约束 enabled=0 / 钩子 enabled=0）', () => {
    const skill = svc.list('skill').find((r) => r.key === 'skill-academic-research')!;
    svc.toggle(skill.id, false);
    const skills = JSON.parse((sqlite.prepare("SELECT value FROM app_setting WHERE key='skills'").get() as { value: string }).value) as { id: string; enabled: number }[];
    expect(skills.find((s) => s.id === `ext-${skill.key}`)?.enabled).toBe(0);

    const constraint = svc.list('constraint').find((r) => r.key === 'constraint-units')!;
    svc.toggle(constraint.id, false);
    const cRow = sqlite.prepare("SELECT enabled FROM config_constraint WHERE title='数值必须带单位'").get() as { enabled: number };
    expect(cRow.enabled).toBe(0);

    const hook = svc.list('hook').find((r) => r.key === 'hook-self-check')!;
    svc.toggle(hook.id, false);
    const hRow = sqlite.prepare("SELECT enabled FROM config_hook WHERE name='结尾自检'").get() as { enabled: number };
    expect(hRow.enabled).toBe(0);
  });

  it('新资产（手填）落库并投影；内置不可物理删除只能停用', () => {
    const row = svc.upsert({ kind: 'constraint', key: 'constraint-custom-1', name: '自定义带单位', description: '', manifest: { title: '自定义带单位', rule: '所有数字带单位', level: 'must', scope: 'all' } }, { source: 'user' });
    expect(svc.get(row.id).enabled).toBe(1);
    expect((sqlite.prepare("SELECT enabled FROM config_constraint WHERE title='自定义带单位'").get() as { enabled: number }).enabled).toBe(1);

    const builtin = svc.list().find((r) => r.source === 'builtin-public')!;
    svc.remove(builtin.id);
    expect(svc.get(builtin.id).enabled).toBe(0); // 停用而非删除
    expect(svc.list().some((r) => r.id === builtin.id)).toBe(true);
  });

  it('恢复内置：全部 builtin 重新启用', () => {
    const builtin = svc.list().filter((r) => r.source.startsWith('builtin'));
    svc.toggle(builtin[0].id, false);
    svc.toggle(builtin[1].id, false);
    expect(svc.resetBuiltin().restored).toBeGreaterThanOrEqual(2);
    expect(svc.list().filter((r) => r.source.startsWith('builtin')).every((r) => r.enabled === 1)).toBe(true);
  });

  it('导入 SKILL.md / 模板 JSON / MCP JSON 均成功，错误逐条返回', () => {
    const r1 = svc.importRaw({ filename: 'SKILL.md', content: '---\nname: imported-skill\ndescription: 导入\n---\n正文步骤' });
    expect(r1.added).toBe(1);
    const r2 = svc.importRaw({ filename: 'x.json', content: JSON.stringify({ kind: 'role', name: '导入角色', manifest: { systemPrompt: '你是导入角色' } }) });
    expect(r2.added).toBe(1);
    const r3 = svc.importRaw({ filename: 'mcp.json', content: JSON.stringify({ mcpServers: { demo: { url: 'https://demo.example/mcp' } } }) });
    expect(r3.added).toBe(1);
    const bad = svc.importRaw({ filename: 'bad.json', content: JSON.stringify([{ kind: 'role', name: '' }]) });
    expect(bad.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('ZIP 导入：识别内部 SKILL.md 与 JSON，坏包给可读错误', () => {
    const zip = zipSync({
      'my-skill/SKILL.md': strToU8('---\nname: zipped-skill\ndescription: 压缩包技能\n---\n步骤'),
      'config.json': strToU8(JSON.stringify({ kind: 'constraint', name: '压缩包约束', manifest: { title: '压缩包约束', rule: 'x', level: 'must', scope: 'all' } })),
    });
    const r = svc.importRaw({ filename: 'pack.zip', content: zip });
    expect(r.assets.length).toBeGreaterThanOrEqual(2);
    expect(svc.list('skill').some((s) => s.key === 'skill-zipped-skill')).toBe(true);
    const broken = svc.importRaw({ filename: 'broken.zip', content: new Uint8Array([1, 2, 3, 4]) });
    expect(broken.errors.length).toBeGreaterThanOrEqual(1);
    expect(broken.errors[0]).toMatch(/ZIP|压缩包/);
  });

  it('一键生成：合法 JSON 返回草稿，非法 JSON 报可读错误', async () => {
    const svc2 = new ExtensionsService(fakeAi(), new ConfigCenterService());
    const r = await svc2.generate('skill', '做一个文献对比技能');
    expect(r.draft.name).toBe('AI 生成技能');
    // jsonrepair 会把 'not json' 修成字符串 "not json" → 结构校验失败（不是崩溃）
    const svc3 = new ExtensionsService(fakeAi({ complete: async () => 'not json' }), new ConfigCenterService());
    await expect(svc3.generate('skill', 'x')).rejects.toThrow(/资产结构不合法|不是合法资产 JSON/);
    // 真正无法修复的输入：模型返回空
    const svc3b = new ExtensionsService(fakeAi({ complete: async () => '' }), new ConfigCenterService());
    await expect(svc3b.generate('skill', 'x')).rejects.toThrow(/不是合法资产 JSON|资产结构不合法/);
    const svc4 = new ExtensionsService(fakeAi({ configured: false }), new ConfigCenterService());
    await expect(svc4.generate('skill', 'x')).rejects.toThrow(/AI 未配置/);
  });

  it('提示词模板默认不覆盖系统默认；显式应用后才写入，且同 toolKey 只保留一个', () => {
    // 播种后不应自动写 custom_prompt（否则会静默改变流水线输出契约）
    expect(sqlite.prepare("SELECT COUNT(*) c FROM custom_prompt WHERE tool_key='polish'").get() as { c: number }).toEqual({ c: 0 });
    const prompts = svc.list('prompt').filter((r) => (JSON.parse(r.manifest) as { toolKey?: string }).toolKey === 'polish');
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    svc.applyPrompt(prompts[0].id);
    const first = sqlite.prepare("SELECT tool_label, enabled FROM custom_prompt WHERE tool_key='polish'").get() as { tool_label: string; enabled: number };
    expect(first.tool_label).toBe(prompts[0].name);
    expect(first.enabled).toBe(1);
    // 切换到另一个模板
    svc.applyPrompt(prompts[1].id);
    const after = sqlite.prepare("SELECT tool_label, enabled FROM custom_prompt WHERE tool_key='polish'").get() as { tool_label: string; enabled: number };
    expect(after.tool_label).toBe(prompts[1].name);
    expect(svc.activePromptKeys().polish).toBe(prompts[1].key);
  });
});

describe('assetKey 稳定性', () => {
  it('英文名生成可读 slug', () => {
    expect(assetKey('skill', 'My Skill!')).toBe('skill-my-skill');
    expect(assetKey('mcp', 'Context7 Docs')).toBe('mcp-context7-docs');
  });
  it('纯中文名回退哈希短码（不产生空 slug 冲突）', () => {
    const a = assetKey('skill', '文献精读矩阵');
    const b = assetKey('skill', '统计口径审计');
    expect(a).toMatch(/^skill-x[0-9a-z]+$/);
    expect(a).not.toBe(b);
  });
  it('符号名同样回退且稳定', () => {
    expect(assetKey('role', '!!!')).toBe(assetKey('role', '!!!'));
    expect(assetKey('role', '!!!')).toMatch(/^role-x[0-9a-z]+$/);
  });
});

describe('AI 生成容错（jsonrepair）', () => {
  it('模型把换行写进字符串（非法 JSON）时自动修复', async () => {
    const badJson = '{"kind":"skill","name":"修复技能","description":"d","manifest":{"mode":"prompt","instructions":"第一行' + String.fromCharCode(10) + '第二行"}}';
    const svc = new ExtensionsService(fakeAi({ complete: async () => badJson }), new ConfigCenterService());
    const r = await svc.generate('skill', 'x');
    expect(r.draft.name).toBe('修复技能');
    expect(String(r.draft.manifest.instructions)).toContain('第二行');
  });
});
