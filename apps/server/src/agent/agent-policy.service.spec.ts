import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentPolicyService, toolAllowedInMode, normalizeAgentAccessMode } from './agent-policy.service';
import { db } from '../db/database';
import { appSettings } from '../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Agent 权限档：默认不能碰系统配置。
 * 这是「AI 不能自己改自己的东西」这条产品约束的执行点，必须锁死。
 */
describe('Agent 权限档', () => {
  let svc: AgentPolicyService;

  beforeEach(() => {
    db.delete(appSettings).where(eq(appSettings.key, 'agent_access_mode')).run();
    svc = new AgentPolicyService();
  });
  afterEach(() => {
    db.delete(appSettings).where(eq(appSettings.key, 'agent_access_mode')).run();
  });

  it('默认档是 workspace，不是 full', () => {
    expect(svc.mode()).toBe('workspace');
    expect(normalizeAgentAccessMode(undefined)).toBe('workspace');
    expect(normalizeAgentAccessMode('bogus')).toBe('workspace');
  });

  it('strict 拒绝所有写入，只读工具放行', () => {
    expect(toolAllowedInMode('strict', 'literature.search')).toBe(true);
    expect(toolAllowedInMode('strict', 'config.preview')).toBe(true);
    expect(toolAllowedInMode('strict', 'config.upsert_role')).toBe(false);
    expect(toolAllowedInMode('strict', 'document.update')).toBe(false);
    expect(toolAllowedInMode('strict', 'experiment.run')).toBe(false);
  });

  it('workspace 允许项目内写入，拒绝系统配置与扩展写入', () => {
    expect(toolAllowedInMode('workspace', 'document.update')).toBe(true);
    expect(toolAllowedInMode('workspace', 'experiment.run')).toBe(true);
    expect(toolAllowedInMode('workspace', 'project.update')).toBe(true);
    expect(toolAllowedInMode('workspace', 'config.upsert_role')).toBe(false);
    expect(toolAllowedInMode('workspace', 'config.set_permission')).toBe(false);
    expect(toolAllowedInMode('workspace', 'extension.create')).toBe(false);
    // 只读的配置工具仍然放行
    expect(toolAllowedInMode('workspace', 'config.snapshot')).toBe(true);
    expect(toolAllowedInMode('workspace', 'extension.list')).toBe(true);
  });

  it('full 允许写系统配置（仍需逐次审批）', () => {
    expect(toolAllowedInMode('full', 'config.upsert_role')).toBe(true);
    expect(toolAllowedInMode('full', 'extension.generate')).toBe(true);
  });

  it('未登记工具在窄档下默认拒绝（新增工具不自动提权）', () => {
    expect(toolAllowedInMode('workspace', 'brand.new.tool')).toBe(false);
    expect(toolAllowedInMode('strict', 'brand.new.tool')).toBe(false);
  });

  it('设置持久化并能切回 strict', () => {
    expect(svc.setMode('full')).toBe('full');
    expect(svc.mode()).toBe('full');
    expect(svc.setMode('strict')).toBe('strict');
    expect(svc.mode()).toBe('strict');
    expect(() => svc.setMode('nope')).toThrow();
  });

  it('拒绝原因可读且区分档位', () => {
    svc.setMode('strict');
    expect(svc.denyReason('document.update')).toContain('只读');
    svc.setMode('workspace');
    expect(svc.denyReason('config.upsert_role')).toContain('最大权限');
  });
});
