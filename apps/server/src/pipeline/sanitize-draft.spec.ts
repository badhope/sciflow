import { describe, expect, it } from 'vitest';
import { PipelineService } from './pipeline.service';

/**
 * 分章起草后处理契约（实测污染）：
 * - 模型复述章节标题 → 不能出现同名双标题
 * - 模型自造「## 参考文献」→ 必须截断（否则文档变成 N 份参考文献、正文被截断）
 */
describe('sanitizeSectionDraft', () => {
  it('剥掉模型复述的标题（含序号）', () => {
    const raw = '## 3 问题定义与理论分析\n\n正文第一段。';
    expect(PipelineService.sanitizeSectionDraft(raw, '问题定义与理论分析')).toBe('正文第一段。');
  });
  it('截断自造参考文献块', () => {
    const raw = '正文内容。\n\n## 参考文献\n\n[1] Fake et al. 2020.';
    const out = PipelineService.sanitizeSectionDraft(raw, '引言');
    expect(out).toBe('正文内容。');
    expect(out).not.toContain('Fake');
  });
  it('去掉代码围栏', () => {
    const raw = '```markdown\n正文。\n```';
    expect(PipelineService.sanitizeSectionDraft(raw, '引言')).toBe('正文。');
  });
  it('正常正文不误伤（含 [Ref:N] 锚点与二级小节）', () => {
    const raw = '### 小节标题\n\n正文引用 [Ref:1]，继续论述。';
    expect(PipelineService.sanitizeSectionDraft(raw, '引言')).toContain('[Ref:1]');
  });
  it('空输入返回空串', () => {
    expect(PipelineService.sanitizeSectionDraft('', '引言')).toBe('');
  });
});
