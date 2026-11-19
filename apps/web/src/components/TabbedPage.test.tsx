import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TabbedPage } from './TabbedPage';
import { useTabActive } from '../lib/tab-visibility';

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
    // 保活：旧 Tab 仍挂载但被隐藏，切回时状态不丢
    expect(screen.getByText('文献内容').closest('[hidden]')).toBeTruthy();
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


function StatefulTab() {
  const [value, setValue] = useState('');
  return <input aria-label="编辑内容" value={value} onChange={(e) => setValue(e.target.value)} />;
}

describe('TabbedPage keep-alive', () => {
  it('preserves visited tab state when switching away and back', async () => {
    render(
      <TabbedPage
        name="写作与评审"
        tabs={[
          { key: 'writing', label: '论文写作', node: <StatefulTab /> },
          { key: 'quality', label: '质量评审', node: <div>评审内容</div> },
        ]}
      />,
    );
    await userEvent.type(screen.getByLabelText('编辑内容'), '未保存草稿');
    await userEvent.click(screen.getByRole('tab', { name: '质量评审' }));
    expect(screen.getByLabelText('编辑内容').closest('[hidden]')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: '论文写作' }));
    expect((screen.getByLabelText('编辑内容') as HTMLInputElement).value).toBe('未保存草稿');
  });
});


function VisibilityProbe() {
  return <span data-testid="tab-probe">{useTabActive() ? 'active' : 'hidden'}</span>;
}

describe('TabbedPage visibility context', () => {
  it('tells hidden pages they are inactive so polling can pause', async () => {
    render(
      <TabbedPage
        name="研究设计"
        tabs={[
          { key: 'programs', label: '研究计划', node: <VisibilityProbe /> },
          { key: 'pipeline', label: '全自动流水线', node: <div>流水线内容</div> },
        ]}
      />,
    );
    expect(screen.getByTestId('tab-probe')).toHaveTextContent('active');
    await userEvent.click(screen.getByRole('tab', { name: '全自动流水线' }));
    expect(screen.getByTestId('tab-probe')).toHaveTextContent('hidden');
    await userEvent.click(screen.getByRole('tab', { name: '研究计划' }));
    expect(screen.getByTestId('tab-probe')).toHaveTextContent('active');
  });
});

describe('TabbedPage scroll keep-alive', () => {
  it('restores the inner scroll position after switching away and back', async () => {
    render(
      <TabbedPage
        name="写作与评审"
        tabs={[
          {
            key: 'writing',
            label: '论文写作',
            node: (
              <div data-testid="scroll-area" style={{ height: 80, overflowY: 'auto' }}>
                <div style={{ height: 400 }}>长文</div>
              </div>
            ),
          },
          { key: 'quality', label: '质量评审', node: <div>评审内容</div> },
        ]}
      />,
    );
    const area = screen.getByTestId('scroll-area');
    area.scrollTop = 120;
    fireEvent.scroll(area);
    await userEvent.click(screen.getByRole('tab', { name: '质量评审' }));
    // 模拟浏览器在 hidden 后丢掉滚动位置；切回应恢复到记录值。
    area.scrollTop = 0;
    await userEvent.click(screen.getByRole('tab', { name: '论文写作' }));
    expect(area.scrollTop).toBe(120);
  });
});
