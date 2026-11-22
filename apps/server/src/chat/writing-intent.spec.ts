import { describe, expect, it } from 'vitest';
import { isLongformWritingRequest } from './writing-intent';

describe('isLongformWritingRequest', () => {
  it('识别起草/撰写/润色/扩写等长文写作动作', () => {
    for (const text of ['帮我起草引言', '请撰写方法一节', '润色这段正文', '把这段扩写成 800 字', '保存到文档']) {
      expect(isLongformWritingRequest(text)).toBe(true);
    }
  });

  it('普通问答不切写作档，保留 500 字简短约束', () => {
    for (const text of ['解释一下什么是 HR 系统强度', '找三个研究空白', '这篇论文的主要局限是什么']) {
      expect(isLongformWritingRequest(text)).toBe(false);
    }
  });

  it('长指令 + 已选文档时兜底识别改写意图', () => {
    expect(isLongformWritingRequest('这段逻辑还是不够顺，帮我把前后因果重新组织一下，保留原有引用锚点并补上过渡句，控制在六百字左右', 'doc content')).toBe(true);
    expect(isLongformWritingRequest('这段逻辑还是不够顺', 'doc content')).toBe(false);
  });

  it('已选文档时识别短续写/改写指令', () => {
    for (const text of ['继续', '接着写', '往下写', '把这段扩一下', '润色一下', '补全这一节']) {
      expect(isLongformWritingRequest(text, 'doc content'), text).toBe(true);
    }
    expect(isLongformWritingRequest('继续', '')).toBe(false);
    expect(isLongformWritingRequest('按这个提纲写完整篇', 'doc content')).toBe(true);
    // “继续”指问答而非续写时不能误切写作档
    expect(isLongformWritingRequest('继续解释一下这个量表的信度口径', 'doc content')).toBe(false);
  });
});
