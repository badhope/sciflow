import type { Doc } from '../types';
import { Select } from './ui';

/**
 * 项目文档选择器：统一「空选项 + 标题列表」的拼装。
 * 写作、质量、实验、投稿四处此前各写一遍 options，占位符和空值语义容易分叉。
 */
export function DocumentSelect({
  docs,
  value,
  onChange,
  placeholder = '选择文档…',
  className = '',
  ariaLabel,
}: {
  docs: Pick<Doc, 'id' | 'title'>[];
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Select
      className={className}
      ariaLabel={ariaLabel}
      value={value ?? ''}
      onChange={(v) => onChange(v || null)}
      options={[{ value: '', label: placeholder }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
    />
  );
}
