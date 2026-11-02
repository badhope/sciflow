import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WritingPreview } from './WritingPreview';

describe('WritingPreview 数学渲染', () => {
  it('将行内公式渲染为 KaTeX DOM，而不是测试环境警告后静默降级', async () => {
    const view = render(
      <WritingPreview content={'结论为 $x^2$。'} editorMode="preview" exported={[]} />,
    );

    await waitFor(() => {
      expect(view.container.querySelector('.katex')).toBeTruthy();
    });
  });
});
