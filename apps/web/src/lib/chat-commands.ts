/**
 * 聊天 slash 命令单一事实源。
 *
 * 此前 WorkspacePage 与 ChatPanel 各写一份：7 条 vs 5 条，模板一个不带 `{{input}}`、
 * 一个带 `{{input}}`，同一句“/润色”在两个入口行为不同。这里统一为一份，
 * 用 `scopes` 控制入口可见性，用 `{{input}}` 统一插入点。
 */
export type ChatCommandScope = 'workspace' | 'doc';

export type ChatCommand = {
  name: string;
  desc: string;
  template: string;
  scopes: ChatCommandScope[];
};

export const CHAT_COMMANDS: ChatCommand[] = [
  {
    name: '润色',
    desc: '提升学术表达质量',
    template: '请润色以下内容，提升学术表达质量，保持原意：\n\n{{input}}',
    scopes: ['workspace', 'doc'],
  },
  {
    name: '翻译英文',
    desc: '翻译为地道学术英文',
    template: '请将以下内容翻译为地道的学术英文：\n\n{{input}}',
    scopes: ['workspace', 'doc'],
  },
  {
    name: '生成摘要',
    desc: '提取要点与关键词',
    template: '请为以下内容生成摘要（3-5 句话）与关键词列表：\n\n{{input}}',
    scopes: ['workspace', 'doc'],
  },
  {
    name: '降重',
    desc: '改写降低重复率',
    template: '请改写以下内容以降低与原文的重复率，保持原意与学术性：\n\n{{input}}',
    scopes: ['workspace', 'doc'],
  },
  {
    name: '补充引用',
    desc: '建议可引用文献与研究',
    template: '请针对以下内容，建议可引用的相关文献与研究并说明理由：\n\n{{input}}',
    scopes: ['workspace', 'doc'],
  },
  {
    name: '生成大纲',
    desc: '围绕主题生成论文大纲',
    template: '请围绕以下主题生成一份论文大纲（章节+要点）：\n\n{{input}}',
    scopes: ['workspace'],
  },
  {
    name: '深入追问',
    desc: '就内容继续深挖',
    template: '请就以下内容进一步深入分析，给出更细致的论证：\n\n{{input}}',
    scopes: ['workspace'],
  },
];

/** 输入 `/` 后的候选；`limit` 保留各入口原有展示数量。 */
export function filterChatCommands(input: string, scope: ChatCommandScope, limit: number, extra: ChatCommand[] = []): ChatCommand[] {
  if (!input.startsWith('/')) return [];
  return [...extra, ...CHAT_COMMANDS].filter((c) => c.scopes.includes(scope) && c.name.includes(input.slice(1))).slice(0, limit);
}

/** 扩展中心里的 chat 提示词 manifest → slash 命令（两个聊天入口都可用）。 */
export function chatPromptCommands(prompts: { title: string; description?: string; template: string }[] | undefined): ChatCommand[] {
  if (!prompts?.length) return [];
  return prompts
    .filter((p) => p.title && p.template)
    .map((p) => ({ name: p.title.slice(0, 20), desc: p.description || '自定义提示词', template: p.template, scopes: ['workspace', 'doc'] as ChatCommandScope[] }));
}

/** 把模板里的插入点替换为空，光标留在末尾；Workspace 与 ChatPanel 共用。 */
export function applyChatCommand(command: ChatCommand): string {
  return command.template.replace('{{input}}', '');
}
