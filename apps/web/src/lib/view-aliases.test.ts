import { describe, expect, it } from 'vitest';
import { canonicalHref } from './view-aliases';

describe('canonicalHref', () => {
  it('把旧写作/质量深链归一为写作与评审，并保留当前稿件', () => {
    expect(canonicalHref('writing', null, 'doc-1')).toBe('/write-review?tab=writing&doc=doc-1');
    expect(canonicalHref('quality', null, 'doc-9')).toBe('/write-review?tab=quality&doc=doc-9');
  });

  it('把长篇/Web/浏览器入口归一为合并页二级 Tab', () => {
    expect(canonicalHref('longform', null, null)).toBe('/write-review?tab=longform');
    expect(canonicalHref('websandbox', null, null)).toBe('/experiments?tab=web');
    expect(canonicalHref('browser', null, null)).toBe('/experiments?tab=browser');
  });

  it('把文献/知识库与计划/流水线归一为二级 Tab', () => {
    expect(canonicalHref('literature', null, null)).toBe('/evidence?tab=literature');
    expect(canonicalHref('knowledge', null, null)).toBe('/evidence?tab=knowledge');
    expect(canonicalHref('programs', null, null)).toBe('/design?tab=programs');
    expect(canonicalHref('pipeline', null, null)).toBe('/design?tab=pipeline');
  });

  it('一级入口与独立工具页不被重定向', () => {
    expect(canonicalHref('dashboard', null, null)).toBeNull();
    expect(canonicalHref('write-review', 'quality', 'doc-1')).toBeNull();
    expect(canonicalHref('memory', null, null)).toBeNull();
    expect(canonicalHref('settings', null, null)).toBeNull();
  });
});
