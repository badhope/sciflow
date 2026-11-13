import { describe, it, expect, afterEach } from 'vitest';
import {
  AGENT_TOOL_PROFILES,
  agentToolGroup,
  isAgentToolProfileId,
  profileAllowsTool,
  resolveAgentToolProfile,
} from './agent-tool-profiles';

/**
 * 工具作用域的回归测试。
 *
 * 为什么要测：工具 schema 每步都要随请求重发（实测带 24 个工具时单次对话
 * prompt_tokens 从 1.9k 涨到 10.9k），且「模型能做什么」是自主科研的受控边界。
 * profile 只能收窄不能放宽——这条不变量必须有测试守着。
 */
const OLD_PROFILE = process.env.AGENT_TOOLS_PROFILE;

afterEach(() => {
  if (OLD_PROFILE === undefined) delete process.env.AGENT_TOOLS_PROFILE;
  else process.env.AGENT_TOOLS_PROFILE = OLD_PROFILE;
});

describe('Agent 工具作用域', () => {
  it('默认 profile 是 full（不改变既有行为）', () => {
    delete process.env.AGENT_TOOLS_PROFILE;
    expect(resolveAgentToolProfile().id).toBe('full');
    expect(profileAllowsTool(resolveAgentToolProfile(), 'config.upsert_role')).toBe(true);
    expect(profileAllowsTool(resolveAgentToolProfile(), 'literature.search')).toBe(true);
  });

  it('环境变量可钉 profile，非法值回落 full', () => {
    process.env.AGENT_TOOLS_PROFILE = 'research';
    expect(resolveAgentToolProfile().id).toBe('research');
    process.env.AGENT_TOOLS_PROFILE = 'not-a-profile';
    expect(resolveAgentToolProfile().id).toBe('full');
    expect(isAgentToolProfileId('not-a-profile')).toBe(false);
  });

  it('research profile 只给只读科研面，配置写入口不可见', () => {
    const p = AGENT_TOOL_PROFILES.research;
    expect(profileAllowsTool(p, 'literature.search')).toBe(true);
    expect(profileAllowsTool(p, 'knowledge.query')).toBe(true);
    expect(profileAllowsTool(p, 'references.extract')).toBe(true);
    expect(profileAllowsTool(p, 'config.upsert_role')).toBe(false);
    expect(profileAllowsTool(p, 'extension.create')).toBe(false);
    expect(profileAllowsTool(p, 'writing.draft')).toBe(false);
  });

  it('experiment profile 可起草产物，但仍不能改配置中心', () => {
    const p = AGENT_TOOL_PROFILES.experiment;
    expect(profileAllowsTool(p, 'writing.draft')).toBe(true);
    expect(profileAllowsTool(p, 'config.snapshot')).toBe(false);
  });

  it('config profile 只暴露配置中心写入口', () => {
    const p = AGENT_TOOL_PROFILES.config;
    expect(profileAllowsTool(p, 'config.upsert_role')).toBe(true);
    expect(profileAllowsTool(p, 'extension.list')).toBe(true);
    expect(profileAllowsTool(p, 'literature.search')).toBe(false);
  });

  it('未登记前缀的工具在窄 profile 下不可见，在 full 下可见', () => {
    expect(agentToolGroup('brand.new.tool')).toBeNull();
    expect(profileAllowsTool(AGENT_TOOL_PROFILES.research, 'brand.new.tool')).toBe(false);
    expect(profileAllowsTool(AGENT_TOOL_PROFILES.full, 'brand.new.tool')).toBe(true);
  });
});
