import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabbedPage } from './TabbedPage';

describe('TabbedPage', () => {
  it('renders the first tab by default and switches without duplicating content', async () => {
    render(
      <TabbedPage
        name="证据库"
        tabs={[
          { key: 'literature', label: '文献库', node: <div>文献内容</div> },
          { key: 'knowledge', label: '知识库', node: <div>知识内容</div> },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: '文献库' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('文献内容')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: '知识库' }));
    expect(screen.getByRole('tab', { name: '知识库' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('知识内容')).toBeTruthy();
    expect(screen.queryByText('文献内容')).toBeNull();
  });

  it('honours initialKey when the route already carries a default tab', () => {
    render(
      <TabbedPage
        name="研究设计"
        initialKey="pipeline"
        tabs={[
          { key: 'programs', label: '研究计划', node: <div>计划</div> },
          { key: 'pipeline', label: '全自动流水线', node: <div>流水线</div> },
        ]}
      />,
    );
    expect(screen.getByText('流水线')).toBeTruthy();
  });
});

describe('TabbedPage controlled mode', () => {
  it('follows activeKey and reports changes', async () => {
    const onChange = vi.fn();
    render(
      <TabbedPage
        name="写作与评审"
        activeKey="quality"
        onChange={onChange}
        tabs={[
          { key: 'writing', label: '论文写作', node: <div>写作</div> },
          { key: 'quality', label: '质量评审', node: <div>评审</div> },
        ]}
      />,
    );
    expect(screen.getByText('评审')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: '论文写作' }));
    expect(onChange).toHaveBeenCalledWith('writing');
  });
});
