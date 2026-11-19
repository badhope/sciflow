import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectStatsBar } from './ProjectStatsBar';

describe('ProjectStatsBar', () => {
  it('bar 变体把五项项目体征收在一行，计数全部来自传入 props', () => {
    render(
      <ProjectStatsBar docCount={3} refCount={12} knowledgeCount={5} pipelineCount={2} experimentCount={7} />,
    );
    expect(screen.getByText('论文草稿')).toBeTruthy();
    expect(screen.getByText('参考文献')).toBeTruthy();
    expect(screen.getByText('知识库资料')).toBeTruthy();
    expect(screen.getByText('流水线任务')).toBeTruthy();
    expect(screen.getByText('实验记录')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('line 变体只显示可用项，不把未加载的计数伪装成 0', () => {
    render(
      <ProjectStatsBar
        variant="line"
        docCount={3}
        refCount={12}
        knowledgeCount={undefined}
        pipelineCount={undefined}
      />,
    );
    expect(screen.getByText('项目上下文')).toBeTruthy();
    expect(screen.getByText('论文草稿')).toBeTruthy();
    expect(screen.getByText('参考文献')).toBeTruthy();
    expect(screen.queryByText('实验记录')).toBeNull();
    expect(screen.queryByText('流水线任务')).toBeNull();
    expect(screen.queryByText('知识库资料')).toBeNull();
  });
});
