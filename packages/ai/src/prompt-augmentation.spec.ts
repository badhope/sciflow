import { describe, expect, it } from 'vitest';
import { buildPromptAugmentation, hookMatchesKeywords } from './prompt-augmentation';

/** 约束工程注入契约：页面预览、AI 调用、CLI 必须看到同一份文本 */
describe('buildPromptAugmentation', () => {
  const constraints = [
    { title: '引用可溯源', rule: '每个事实性结论必须标注来源', level: 'must', scope: 'all', sortOrder: 2 },
    { title: '不编造数据', rule: '无法确认的数据必须写「不确定」', level: 'must_not', scope: 'all', sortOrder: 1 },
    { title: '聊天简洁', rule: '聊天回答不超过 300 字', level: 'should', scope: 'chat', sortOrder: 3 },
    { title: '流水线结构化', rule: '章节输出必须为 Markdown', level: 'must', scope: 'pipeline', sortOrder: 1 },
    { title: '研究计划四道门', rule: '查新、构念、算术、复核', level: 'must', scope: 'all', sortOrder: 4 },
    { title: '写作档专用', rule: '长文必须保留引用锚点', level: 'must', scope: 'writing', sortOrder: 5 },
    { title: '已停用', rule: '不应出现', level: 'must', scope: 'all', enabled: 0, sortOrder: 0 },
  ];

  it('按 scope 过滤 + sortOrder 排序 + 中文等级标签', () => {
    const chat = buildPromptAugmentation(constraints, [], 'chat');
    expect(chat).toContain('【全局约束');
    expect(chat).toContain('1. [禁止] 不编造数据');
    expect(chat).toContain('2. [必须] 引用可溯源');
    expect(chat).toContain('聊天简洁');
    expect(chat).not.toContain('流水线结构化');
    expect(chat).not.toContain('已停用');

    const pipeline = buildPromptAugmentation(constraints, [], 'pipeline');
    expect(pipeline).toContain('流水线结构化');
    expect(pipeline).not.toContain('聊天简洁');

    // 聊天入口写论文：继承 pipeline 约束，但不能把“500 字聊天简洁”带进长文。
    const writing = buildPromptAugmentation(constraints, [], 'writing');
    expect(writing).toContain('流水线结构化');
    expect(writing).toContain('引用可溯源');
    expect(writing).toContain('研究计划四道门');
    expect(writing).toContain('写作档专用');
    expect(writing).not.toContain('聊天简洁');
    // writing 档不能反向污染 chat/pipeline
    expect(chat).not.toContain('写作档专用');
    expect(pipeline).not.toContain('写作档专用');
    expect(writing).not.toContain('已停用');
  });

  it('prompt_inject 钩子按事件匹配注入，非注入型钩子忽略', () => {
    const hooks = [
      { name: '语气', event: 'chat:before', type: 'prompt_inject', config: JSON.stringify({ text: '回答结尾加【已遵守约束】' }), priority: 10 },
      { name: '流水线备注', event: 'pipeline:before', type: 'prompt_inject', config: JSON.stringify({ text: '先列提纲再写' }) },
      { name: '拦截器', event: 'chat:before', type: 'block', config: '{}' },
      { name: '停用注入', event: 'chat:before', type: 'prompt_inject', config: JSON.stringify({ text: '不该出现' }), enabled: 0 },
      { name: '坏 JSON', event: 'chat:before', type: 'prompt_inject', config: '{oops' },
    ];
    const chat = buildPromptAugmentation([], hooks, 'chat');
    expect(chat).toContain('回答结尾加【已遵守约束】');
    expect(chat).not.toContain('先列提纲再写');
    expect(chat).not.toContain('不该出现');
    expect(chat).not.toContain('坏 JSON');
    expect(buildPromptAugmentation([], hooks, 'pipeline')).toContain('先列提纲再写');
    // writing 继承 pipeline:before 钩子，不继承 chat:before 的闲聊要求
    const writing = buildPromptAugmentation([], hooks, 'writing');
    expect(writing).toContain('先列提纲再写');
    expect(writing).not.toContain('回答结尾加【已遵守约束】');
  });

  it('空输入返回空串（不注入空标题）', () => {
    expect(buildPromptAugmentation([], [], 'chat')).toBe('');
    expect(buildPromptAugmentation([{ title: 'x', rule: 'y', enabled: 0 }], [], 'chat')).toBe('');
  });
});

describe('hookMatchesKeywords', () => {
  it('always 恒命中', () => {
    expect(hookMatchesKeywords('任意内容', { when: 'always' })).toBe(true);
    expect(hookMatchesKeywords('任意内容', {})).toBe(true);
  });
  it('keyword 模式下任一关键词命中（大小写不敏感）', () => {
    expect(hookMatchesKeywords('请输出 API_KEY 配置', { when: 'keyword', keywords: ['api_key'] })).toBe(true);
    expect(hookMatchesKeywords('普通问题', { when: 'keyword', keywords: ['api_key', '密钥'] })).toBe(false);
  });
  it('keyword 模式无关键词时保守命中（配置错误不放大为漏拦截）', () => {
    expect(hookMatchesKeywords('x', { when: 'keyword', keywords: [] })).toBe(true);
  });
});
