import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocumentSelect } from './DocumentSelect';

describe('DocumentSelect', () => {
  it('adds one empty option and reports null when cleared', async () => {
    const onChange = vi.fn();
    render(
      <DocumentSelect
        ariaLabel="文档"
        docs={[{ id: 'd1', title: '论文 A' }, { id: 'd2', title: '论文 B' }]}
        value="d1"
        onChange={onChange}
      />,
    );
    const select = screen.getByRole('combobox', { name: '文档' }) as HTMLSelectElement;
    expect(select.options).toHaveLength(3);
    expect(select.options[0].text).toBe('选择文档…');
    await userEvent.selectOptions(select, '');
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
