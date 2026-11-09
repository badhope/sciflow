import { describe, expect, it } from 'vitest';
import { isJsonStringArray, parseJson, parseStringList, parseTagsJson } from './json-guard';

/**
 * json-guard 回归。
 *
 * 缺陷一：parseTagsJson 直接返回 `parseJsonArray<string>` 的结果，而后者只做 `x as T` 的
 * 类型断言、不做运行时转换 → `'[1,2]'` 返回 `[1,2]`、`'[null]'` 返回 `[null]`。
 * 返回值类型上是 string[]、运行时是 number/null，会原样进 graph() 等 API 响应，
 * 前端一调 tag.trim() 就抛 TypeError —— 类型系统看不出、既有测试也覆盖不到。
 *
 * 缺陷二：references 服务用长度启发式（`parsed.length===0 && raw.trim().length>2`）判非法 JSON，
 * `'{}'`、`'ab'` 因长度 ≤2 被直接放行落库。
 */
describe('parseTagsJson：返回值必须真的是 string[]', () => {
  it('数字/布尔元素被转成字符串，不再是运行时的 number', () => {
    const tags = parseTagsJson('[1,2,true]');
    expect(tags).toEqual(['1', '2', 'true']);
    expect(tags.every((t) => typeof t === 'string')).toBe(true);
    // 消费端最常见的两个调用不得抛异常
    expect(() => tags.map((t) => t.trim().toLowerCase())).not.toThrow();
  });

  it('null / 嵌套对象 / 数组元素被丢弃，不会泄漏到响应里', () => {
    expect(parseTagsJson('[null,"a",[1],{"b":2}]')).toEqual(['a']);
    // 裸 undefined 不是合法 JSON → 整体解析失败 → 空数组（而非抛异常）
    expect(parseTagsJson('[null,"a",undefined]')).toEqual([]);
  });

  it('空串与纯空白元素被过滤', () => {
    expect(parseTagsJson('["", "  ", "x"]')).toEqual(['x']);
  });

  it('null / 空串 / 坏 JSON / 非数组 → 空数组（既有容错行为不变）', () => {
    expect(parseTagsJson(null)).toEqual([]);
    expect(parseTagsJson('')).toEqual([]);
    expect(parseTagsJson('{oops')).toEqual([]);
    expect(parseTagsJson('{"a":1}')).toEqual([]);
  });

  it('与 parseStringList 的文档承诺一致（字符串数组输入下输出相同）', () => {
    const raw = '["机器学习","综述"]';
    expect(parseTagsJson(raw)).toEqual(parseStringList(raw));
  });
});

describe('isJsonStringArray：结构化校验取代长度启发式', () => {
  it('合法字符串数组 → true', () => {
    expect(isJsonStringArray('[]')).toBe(true);
    expect(isJsonStringArray('["a","b"]')).toBe(true);
    expect(isJsonStringArray(' [ "a" ] ')).toBe(true);
  });

  it('长度 ≤2 的脏输入不再被放行（旧启发式的漏网点）', () => {
    expect(isJsonStringArray('{}')).toBe(false);
    expect(isJsonStringArray('ab')).toBe(false);
    expect(isJsonStringArray('[]x')).toBe(false);
  });

  it('非字符串元素 / 非数组 / 坏 JSON / 空值 → false', () => {
    expect(isJsonStringArray('[1,2]')).toBe(false);
    expect(isJsonStringArray('[null]')).toBe(false);
    expect(isJsonStringArray('"just a string"')).toBe(false);
    expect(isJsonStringArray('[oops')).toBe(false);
    expect(isJsonStringArray('')).toBe(false);
    expect(isJsonStringArray(null)).toBe(false);
  });
});

describe('parseJson：既有行为不回归', () => {
  it('空值与坏 JSON 回落 fallback', () => {
    expect(parseJson(null, { a: 1 })).toEqual({ a: 1 });
    expect(parseJson('', { a: 1 })).toEqual({ a: 1 });
    expect(parseJson('{bad', { a: 1 })).toEqual({ a: 1 });
    expect(parseJson('{"b":2}', { a: 1 })).toEqual({ b: 2 });
  });
});
