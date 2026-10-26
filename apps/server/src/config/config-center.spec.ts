import { beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../db/database';
import { ConfigCenterService } from './config-center.service';
import { decidePermission } from './permission';

/**
 * 配置中心服务契约（角色/约束/钩子/权限/审计/预设）：
 * - 写操作过权限矩阵，被拒时必须落「拒绝审计」且抛出可读原因
 * - 全面放开档可改全部受管类别；核心保护项不在此服务暴露
 * - 约束与钩子真实落库，预览文本来自同一实现（AI 调用侧复用）
 * - 预设应用幂等（重复应用不叠加 preset 来源的约束）
 */

function fresh() {
  sqlite.prepare('DELETE FROM config_role').run();
  sqlite.prepare('DELETE FROM config_constraint').run();
  sqlite.prepare('DELETE FROM config_hook').run();
  sqlite.prepare('DELETE FROM config_audit').run();
  sqlite.prepare("DELETE FROM app_setting WHERE key = 'config_permission_mode'").run();
  const svc = new ConfigCenterService();
  return svc;
}

describe('配置中心·权限与审计', () => {
  beforeEach(() => { fresh(); });

  it('默认档为全面放开；strict 下写操作被拒并留拒绝审计', () => {
    const svc = fresh();
    expect(svc.getPermissionMode()).toBe('unrestricted');
    svc.setPermissionMode('strict');
    expect(() => svc.createConstraint({ title: 't', rule: 'r' })).toThrow(/严格/);
    const denied = svc.listAudit(20).filter((a) => (a as { allowed: number }).allowed === 0);
    expect(denied.length).toBeGreaterThanOrEqual(1);
    expect(String(denied[0].reason)).toContain('严格');
  });

  it('balanced 下 provider/websearch 类别不可改，角色/约束可改', () => {
    const svc = fresh();
    svc.setPermissionMode('balanced');
    expect(() => svc.assertAllowed('provider')).toThrow();
    expect(() => svc.assertAllowed('role')).not.toThrow();
    expect(decidePermission('balanced', 'provider').allowed).toBe(false);
  });

  it('全面放开档写操作全部放行，且每笔变更留审计（actor=chat 可用于对话入口）', () => {
    const svc = fresh();
    svc.createRole({ name: '测试角色', systemPrompt: '你是测试' }, 'chat');
    svc.createConstraint({ title: '引用', rule: '标注来源' }, 'chat');
    svc.createHook({ name: '拦截', event: 'chat:before', type: 'block', config: { when: 'keyword', keywords: ['密钥'] } }, 'chat');
    const audit = svc.listAudit(50).filter((a) => (a as { actor: string }).actor === 'chat');
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(svc.listRoles().length).toBeGreaterThanOrEqual(2); // 种子默认角色 + 测试角色
  });
});

describe('配置中心·角色/约束/钩子持久化与预览', () => {
  beforeEach(() => { fresh(); });

  it('种子角色为默认；创建新默认角色会取消旧的', () => {
    const svc = fresh();
    const seeded = svc.listRoles().filter((r) => r.isDefault === 1);
    expect(seeded.length).toBe(1);
    svc.createRole({ name: '新默认', systemPrompt: '新提示词', isDefault: true });
    const defaults = svc.listRoles().filter((r) => r.isDefault === 1);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe('新默认');
  });

  it('默认角色不可删除', () => {
    const svc = fresh();
    const d = svc.listRoles().find((r) => r.isDefault === 1)!;
    expect(() => svc.deleteRole(d.id)).toThrow(/默认角色不可删除/);
  });

  it('约束按 scope 注入预览；停用后不再出现', () => {
    const svc = fresh();
    const [c] = svc.createConstraint({ title: '只聊天', rule: '聊天专用规则', scope: 'chat', level: 'must' }, 'test');
    const chat = svc.preview('chat');
    expect(chat.text).toContain('聊天专用规则');
    expect(svc.preview('pipeline').text).not.toContain('聊天专用规则');
    const target = svc.listConstraints().find((x) => x.title === '只聊天')!;
    svc.updateConstraint(target.id, { enabled: 0 });
    expect(svc.preview('chat').text).not.toContain('聊天专用规则');
    expect(c.id).toBeTruthy();
  });

  it('钩子 prompt_inject 注入到预览；block 钩子按关键词拦截', async () => {
    const svc = fresh();
    svc.createHook({ name: '加一句', event: 'chat:before', type: 'prompt_inject', config: { text: '回答后附一句风险提示' } }, 'test');
    expect(svc.preview('chat').text).toContain('回答后附一句风险提示');
    svc.createHook({ name: '敏感拦截', event: 'chat:before', type: 'block', config: { when: 'keyword', keywords: ['导出密钥'], reason: '禁止导出密钥' } }, 'test');
    const hit = await svc.runEventHooks('chat:before', { text: '帮我导出密钥' });
    expect(hit.blocked).toBe('禁止导出密钥');
    const miss = await svc.runEventHooks('chat:before', { text: '普通问题' });
    expect(miss.blocked).toBeUndefined();
    const denied = svc.listAudit(20).filter((a) => (a as { action: string }).action === 'block');
    expect(denied.length).toBeGreaterThanOrEqual(1);
  });

  it('webhook 钩子经 SSRF 守卫：内网地址被拒并记审计，不抛错', async () => {
    const svc = fresh();
    svc.createHook({ name: '内网 webhook', event: 'chat:after', type: 'webhook', config: { url: 'http://127.0.0.1:9999/hook' } }, 'test');
    const r = await svc.runEventHooks('chat:after', { text: 'x' });
    expect(r.errors.length).toBeGreaterThanOrEqual(1);
    expect(String(r.errors[0])).toMatch(/内网|保留|回环|私有/);
    expect(svc.listAudit(20).some((a) => (a as { action: string }).action === 'webhook_blocked')).toBe(true);
  });

  it('钩子事件/类型/JSON 校验 fail-closed', () => {
    const svc = fresh();
    expect(() => svc.createHook({ name: 'x', event: 'bad', type: 'prompt_inject' })).toThrow(/事件/);
    expect(() => svc.createHook({ name: 'x', event: 'chat:before', type: 'bad' })).toThrow(/类型/);
    expect(() => svc.createHook({ name: 'x', event: 'chat:before', type: 'prompt_inject', config: '{bad' })).toThrow(/JSON/);
    expect(() => svc.createHook({ name: 'x', event: 'chat:before', type: 'webhook', config: {} })).toThrow(/webhook/);
  });
});

describe('配置中心·预设', () => {
  beforeEach(() => { fresh(); });

  it('应用预设写入角色+约束+钩子，重复应用不叠加', () => {
    const svc = fresh();
    svc.applyPreset('reviewer-strict');
    const first = svc.listConstraints().filter((c) => c.source === 'preset').length;
    expect(first).toBeGreaterThanOrEqual(2);
    svc.applyPreset('reviewer-strict');
    expect(svc.listConstraints().filter((c) => c.source === 'preset').length).toBe(first);
    expect(svc.listRoles().some((r) => r.name === '顶刊审稿人' && r.isDefault === 1)).toBe(true);
    expect(svc.listHooks().some((h) => h.name.includes('评审结构'))).toBe(true);
  });

  it('未知预设返回 400 语义错误', () => {
    const svc = fresh();
    expect(() => svc.applyPreset('nope')).toThrow(/预设不存在/);
  });
});

describe('配置中心·导入导出', () => {
  beforeEach(() => { fresh(); });

  it('导出的包不含审计字段，导入后配置生效且含跳过统计', () => {
    const svc = fresh();
    svc.createConstraint({ title: '导出测试约束', rule: '导出规则' }, 'test');
    const bundle = svc.exportBundle();
    expect(JSON.stringify(bundle)).not.toContain('config_audit');
    expect(bundle.constraints.some((c) => c.title === '导出测试约束')).toBe(true);
    const r = svc.importBundle({
      roles: [{ name: '导入角色', systemPrompt: '导入提示词', isDefault: true }],
      constraints: [{ title: '导入约束', rule: '导入规则', level: 'must', scope: 'chat' }, { title: '', rule: 'x' }],
      hooks: [{ name: '导入钩子', event: 'chat:before', type: 'prompt_inject', config: { text: '导入钩子文本' } }, { name: '坏钩子', event: 'bad', type: 'prompt_inject' }],
    }, { merge: true }, 'cli');
    expect(r.rolesAdded).toBe(1);
    expect(r.constraintsAdded).toBe(1);
    expect(r.hooksAdded).toBe(1);
    expect(r.errors.length).toBe(2);
    expect(svc.listRoles().some((x) => x.name === '导入角色' && x.isDefault === 1)).toBe(true);
    expect(svc.preview('chat').text).toContain('导入钩子文本');
    expect(svc.listAudit(20).some((a) => (a as { action: string }).action === 'import')).toBe(true);
  });

  it('导入也受权限矩阵约束（strict 拒绝）', () => {
    const svc = fresh();
    svc.setPermissionMode('strict');
    expect(() => svc.importBundle({ constraints: [{ title: 'x', rule: 'y' }] }, {}, 'ui')).toThrow(/严格/);
  });

  it('重复导入同一配置包不叠加（同标题同规则跳过）', () => {
    const svc = fresh();
    const bundle = { constraints: [{ title: '幂等约束', rule: '幂等规则' }], hooks: [{ name: '幂等钩子', event: 'chat:before', type: 'prompt_inject', config: { text: 'x' } }] };
    const first = svc.importBundle(bundle, { merge: true }, 'test');
    expect(first.constraintsAdded).toBe(1);
    expect(first.hooksAdded).toBe(1);
    const second = svc.importBundle(bundle, { merge: true }, 'test');
    expect(second.constraintsAdded).toBe(0);
    expect(second.hooksAdded).toBe(0);
    expect(svc.listConstraints().filter((c) => c.title === '幂等约束')).toHaveLength(1);
  });

  it('replace 模式清空用户自建约束后写入', () => {
    const svc = fresh();
    svc.createConstraint({ title: '旧的用户约束', rule: 'old' }, 'test');
    const r = svc.importBundle({ constraints: [{ title: '新的导入约束', rule: 'new' }] }, { merge: false }, 'test');
    expect(r.constraintsAdded).toBe(1);
    const titles = svc.listConstraints().map((c) => c.title);
    expect(titles).toContain('新的导入约束');
    expect(titles).not.toContain('旧的用户约束');
  });
});
