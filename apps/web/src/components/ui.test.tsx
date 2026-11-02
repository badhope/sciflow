import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, Badge, Card, Empty, Spinner, Input, Select } from './ui';

describe('Button', () => {
  it('renders children and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>保存</Button>);
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables interaction while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        生成
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /生成/ });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders disabled state', () => {
    render(
      <Button disabled>
        <span>删除</span>
      </Button>,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('Badge / Spinner / Empty', () => {
  it('Badge renders text with tone class', () => {
    render(<Badge tone="green">通过</Badge>);
    const el = screen.getByText('通过');
    expect(el.className).toContain('emerald');
  });

  it('Spinner exposes status role and default label', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('处理中…')).toBeTruthy();
  });

  it('Empty shows text and hint', () => {
    render(<Empty text="暂无项目" hint="先创建一个项目" />);
    expect(screen.getByText('暂无项目')).toBeTruthy();
    expect(screen.getByText('先创建一个项目')).toBeTruthy();
  });
});

describe('Input / Select', () => {
  it('Input forwards typing', async () => {
    render(<Input placeholder="研究主题" />);
    const input = screen.getByPlaceholderText('研究主题');
    await userEvent.type(input, '图神经网络');
    expect((input as HTMLInputElement).value).toBe('图神经网络');
  });

  it('Select calls onChange with picked value', () => {
    const onChange = vi.fn();
    render(
      <Select
        value="apa"
        onChange={onChange}
        options={[
          { value: 'apa', label: 'APA' },
          { value: 'ieee', label: 'IEEE' },
        ]}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ieee' } });
    expect(onChange).toHaveBeenCalledWith('ieee');
  });
});

describe('Card 表面语义（SurfaceTone）', () => {
  it('默认 panel：唯一带阴影的主面板层级', () => {
    const { container } = render(<Card>内容</Card>);
    expect(container.firstElementChild!.className).toContain('surface-panel');
  });

  it('inset：内嵌区不带阴影（避免卡套卡）', () => {
    const { container } = render(<Card tone="inset">内嵌</Card>);
    expect(container.firstElementChild!.className).toContain('surface-inset');
    expect(container.firstElementChild!.className).not.toContain('surface-panel');
  });

  it('metric / accent / warning / danger 各自独立类名', () => {
    for (const tone of ['metric', 'accent', 'warning', 'danger'] as const) {
      const { container } = render(<Card tone={tone}>x</Card>);
      expect(container.firstElementChild!.className).toContain(`surface-${tone}`);
    }
  });

  it('plain：纯容器不渲染表面类', () => {
    const { container } = render(<Card tone="plain">x</Card>);
    const cls = container.firstElementChild!.className;
    expect(cls).not.toMatch(/surface-(panel|inset|metric|accent|warning|danger)/);
  });
});
