import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { InputValidationPipe } from './input-validation.pipe';

/**
 * 全局输入校验管道回归。
 *
 * 历史缺陷（v1.9.1）：此前对标量 body 也抛 400，而 Nest 的 `@Body('field')` 逐字段取参
 * 会让管道收到 string —— `POST /api/references/gap`（研究缺口）因此**全量不可用**，
 * 前端按钮永远收到「请求体必须是 JSON 对象」。该缺陷存在两个版本未被发现，
 * 因为回归脚本没覆盖这条路由。
 */
describe('InputValidationPipe', () => {
  const pipe = new InputValidationPipe();
  const bodyMeta = { type: 'body' as const };

  it('对象 body 正常放行（原样返回，不剥字段）', () => {
    const v = { projectId: 'p1', topic: 'gnn' };
    expect(pipe.transform(v, bodyMeta)).toBe(v);
  });

  it('@Body("field") 的标量入参必须放行（历史缺陷：被无差别打成 400）', () => {
    expect(pipe.transform('p1', bodyMeta)).toBe('p1');
    expect(pipe.transform(42, bodyMeta)).toBe(42);
    expect(pipe.transform(true, bodyMeta)).toBe(true);
  });

  it('数组 body 仍然拒绝（非法负载防线不放松）', () => {
    expect(() => pipe.transform([1, 2], bodyMeta)).toThrow(BadRequestException);
    expect(() => pipe.transform([], bodyMeta)).toThrow(/JSON 对象/);
  });

  it('undefined / null 放行（可选 body 端点）', () => {
    expect(pipe.transform(undefined, bodyMeta)).toBeUndefined();
    expect(pipe.transform(null, bodyMeta)).toBeNull();
  });

  it('非 body 类型（param/query）一律原样放行', () => {
    expect(pipe.transform('abc', { type: 'param' as const })).toBe('abc');
    expect(pipe.transform('abc', { type: 'query' as const })).toBe('abc');
  });
});
