import { describe, it, expect } from 'vitest';
import { redactSensitive, redactText, shouldRedactForMode, REDACTED } from './redaction';

/**
 * 字段级脱敏：strict 档下敏感字段连「看」都不允许。
 * 这是「AI 不能读自己的密钥」这条产品约束的执行点。
 */
describe('字段级脱敏', () => {
  it('按键名抹掉密钥/路径字段', () => {
    const out = redactSensitive({
      ai: { baseUrl: 'https://api.example.com', apiKey: 'sk-should-not-leak-1234567890', model: 'x' },
      databasePath: 'D:\\data\\sciflow.db',
      workDir: '/tmp/abc',
      ok: true,
    }) as any;
    expect(out.ai.apiKey).toBe(REDACTED);
    expect(out.databasePath).toBe(REDACTED);
    expect(out.workDir).toBe(REDACTED);
    // 非敏感字段保留
    expect(out.ai.baseUrl).toBe('https://api.example.com');
    expect(out.ai.model).toBe('x');
    expect(out.ok).toBe(true);
  });

  it('字段名不敏感但值像密钥，也抹掉', () => {
    const out = redactSensitive({ note: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', plain: 'hello' }) as any;
    expect(out.note).toBe(REDACTED);
    expect(out.plain).toBe('hello');
  });

  it('本项目加密列前缀 v1: 被识别', () => {
    const out = redactSensitive({ value: 'v1:AbCdEfGhIjKlMnOpQrStUvWx' }) as any;
    expect(out.value).toBe(REDACTED);
  });

  it('嵌套数组与对象递归处理，且不修改入参', () => {
    const input = { list: [{ token: 'abc', name: 'n1' }, { name: 'n2' }] };
    const out = redactSensitive(input) as any;
    expect(out.list[0].token).toBe(REDACTED);
    expect(out.list[0].name).toBe('n1');
    expect(input.list[0].token).toBe('abc');
  });

  it('循环引用不爆栈', () => {
    const a: any = { name: 'a' };
    a.self = a;
    const out = redactSensitive(a) as any;
    expect(out.name).toBe('a');
    expect(out.self).toBe('[循环引用]');
  });

  it('文本脱敏抹掉形似密钥的片段', () => {
    const t = redactText('key=sk-abcdefghijklmnop1234 and token=ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(t).not.toContain('sk-abcdefghijklmnop1234');
    expect(t).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(t).toContain(REDACTED);
  });

  it('只有 strict 档需要脱敏', () => {
    expect(shouldRedactForMode('strict')).toBe(true);
    expect(shouldRedactForMode('workspace')).toBe(false);
    expect(shouldRedactForMode('full')).toBe(false);
  });
});
