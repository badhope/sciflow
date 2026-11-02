import { describe, expect, it } from 'vitest';
import { extractMessageText, mockContentFromBody } from './mock-gateway';

/**
 * mock 网关回归（v1.9.3 修复护栏）。
 *
 * 历史缺陷 #1（严重）：AI SDK 发送的 `content` 是结构化数组
 * （`[{type:'text', text:'...'}]`），而 getLastUserContent 原来直接 `String(content)`
 * → 得到 "[object Object]" → **所有路由规则全部失配** → mock 恒返回兜底回复。
 * 后果：此前所有「mock 全链路回归」里每个 AI 步骤拿到的都是同一段通用问答文本，
 * 等于只验证了管道连通性，没验证任何步骤契约。修复后必须三形态全部正确路由。
 */

describe('extractMessageText（AI SDK content 三形态）', () => {
  it('字符串原样返回', () => {
    expect(extractMessageText('你好')).toBe('你好');
  });

  it('纯文本 part 数组拼接（AI SDK v5+ 主形态）', () => {
    expect(extractMessageText([{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }])).toBe('第一段\n第二段');
  });

  it('混合数组：只取 text part，忽略 image/file 等二进制 part', () => {
    const mixed = [
      { type: 'text', text: '请看图' },
      { type: 'image', data: new Uint8Array([1, 2, 3]) },
      { type: 'file', data: 'x' },
      { type: 'text', text: '正常' },
    ];
    expect(extractMessageText(mixed)).toBe('请看图\n正常');
  });

  it('单对象 { text } 与空值兜底', () => {
    expect(extractMessageText({ text: '对象形态' })).toBe('对象形态');
    expect(extractMessageText(undefined)).toBe('');
    expect(extractMessageText(null)).toBe('');
    expect(extractMessageText(123)).toBe('');
  });
});

describe('mockContentFromBody 路由（数组 content 必须命中规则而非兜底）', () => {
  const FALLBACK_MARK = '本地 mock 网关';

  it('连接测试：数组 content 也返回「正常」（此前返回兜底 = 缺陷复现）', () => {
    const out = mockContentFromBody({ messages: [{ role: 'user', content: [{ type: 'text', text: '请只回复两个字：正常' }] }] });
    expect(out).toBe('正常');
  });

  it('大纲生成：数组 content 命中大纲规则（可解析 JSON 且含 sections）', () => {
    const out = mockContentFromBody({
      messages: [{ role: 'user', content: [{ type: 'text', text: '你是一位资深学术写作专家。请设计论文大纲，输出严格 JSON（"sections"）。' }] }],
    });
    expect(out).not.toContain(FALLBACK_MARK);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out).sections).toBeInstanceOf(Array);
  });

  it('章节起草（空文献池）：无 [Ref:N] 输出——mock 必须与真实模型同守「空池禁引用」契约', () => {
    const prompt = '你是一位学术论文写作者。请起草论文的一个章节。\n章节：引言\n可用文献（编号即引用键，只允许引用下面这些文献，禁止编造）：\n（无可用文献——见下方引用规则）';
    const out = mockContentFromBody({ messages: [{ role: 'user', content: prompt }] });
    expect(out).not.toContain(FALLBACK_MARK);
    expect(out).not.toMatch(/\[Ref:\d+\]/);
    expect(out).not.toMatch(/\[\d+\]/);
  });

  it('章节起草（有文献池）：正文带 [Ref:N] 锚点', () => {
    const prompt = '你是一位学术论文写作者。请起草论文的一个章节。\n章节：方法\n可用文献：\n[Ref:1] 某某（2024）消息传递研究';
    const out = mockContentFromBody({ messages: [{ role: 'user', content: prompt }] });
    expect(out).toMatch(/\[Ref:\d+\]/);
  });

  it('不同章节返回不同内容（同段重复会触发客观检查「重复段落」硬伤）', () => {
    const mk = (sec: string) => mockContentFromBody({
      messages: [{ role: 'user', content: `你是一位学术论文写作者。请起草论文的一个章节。\n章节：${sec}\n可用文献：\n[Ref:1] A` }],
    });
    const intro = mk('引言');
    const method = mk('方法');
    const conclusion = mk('结论');
    expect(intro).not.toBe(method);
    expect(method).not.toBe(conclusion);
    expect(intro).not.toBe(conclusion);
  });

  it('检索重排：命中重排规则并按关键词给分（此前无规则 → 静默失效）', () => {
    const prompt = '给定用户问题与候选资料块，为每块的相关性打 0-10 分（0 无关，10 直接回答问题）。只输出 JSON：{"scores":[{"id":"...","score":N}]}\n\n问题：消息传递\n\n候选块：\n[0] id=a\n图神经网络通过消息传递聚合邻居特征\n---\n[1] id=b\n强化学习通过策略梯度优化行为';
    const out = mockContentFromBody({ messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(out);
    const byId = new Map(parsed.scores.map((s: { id: string; score: number }) => [s.id, s.score]));
    expect(byId.get('a')).toBeGreaterThan(byId.get('b')!);
  });

  it('润色：从 prompt 抽出待处理正文（「待处理文本：」模板分支）', () => {
    const prompt = '你是一位学术语言编辑。请对下面的文本进行「polish」处理。\n\n待处理文本：\n图神经网络通过消息传递聚合邻居特征。\n\n请只输出一个合法的纯 JSON 对象；JSON 结构：{"original":"原文","polished":"处理后的文本","reason":"说明"}';
    const out = mockContentFromBody({ messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(out);
    expect(parsed.original).toBe('图神经网络通过消息传递聚合邻居特征。');
    expect(parsed.polished).toBe(parsed.original);
  });

  it('润色：自定义提示词分支（「待处理正文：」标记同样识别）', () => {
    // 真实自定义分支 = polishCustom + "\n\n待处理正文：\n" + part；
    // mock 规则命中要求 prompt 同时含「学术语言编辑」与「polished」（自定义 prompt 需自带输出结构说明）
    const prompt = '你是一位学术语言编辑。请按自定义风格润色，输出 {"original":"原文","polished":"结果"} 结构（polished 字段必须存在）。\n\n待处理正文：\n需要润色的正文内容。';
    const out = mockContentFromBody({ messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(out);
    expect(parsed.original).toBe('需要润色的正文内容。');
  });
});
