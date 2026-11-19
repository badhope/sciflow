import { describe, expect, it } from 'vitest';
import { applyChatCommand, CHAT_COMMANDS, filterChatCommands } from './chat-commands';

describe('chat-commands', () => {
  it('工作台与写作面板共用同一份命令，按 scope 过滤', () => {
    expect(filterChatCommands('/润色', 'workspace', 5).map((c) => c.name)).toEqual(['润色']);
    expect(filterChatCommands('/润色', 'doc', 4).map((c) => c.name)).toEqual(['润色']);
    expect(filterChatCommands('/生成大纲', 'workspace', 5).map((c) => c.name)).toEqual(['生成大纲']);
    expect(filterChatCommands('/生成大纲', 'doc', 4)).toEqual([]);
  });

  it('前缀不匹配或非 slash 输入返回空候选', () => {
    expect(filterChatCommands('润色', 'workspace', 5)).toEqual([]);
    expect(filterChatCommands('/不存在', 'workspace', 5)).toEqual([]);
  });

  it('插入模板时清掉 {{input}} 占位，光标留在末尾', () => {
    const command = CHAT_COMMANDS.find((c) => c.name === '润色');
    expect(command).toBeDefined();
    expect(applyChatCommand(command!)).toBe('请润色以下内容，提升学术表达质量，保持原意：\n\n');
    expect(applyChatCommand(command!)).not.toContain('{{input}}');
  });
});
