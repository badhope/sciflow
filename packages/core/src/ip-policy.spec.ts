import { describe, expect, it } from 'vitest';
import { isBlockedAddress, isCloudMetadataAddress, isIpLiteral } from './ip-policy';

/**
 * IPv4-in-IPv6 翻译地址回归（SSRF 纵深防御）。
 *
 * 缺陷：`unmapV4` 只认 `::ffff:a.b.c.d` / `::ffff:xxxx:xxxx` 两种**IPv4-mapped**形态，
 * 其余把 IPv4 嵌进 IPv6 的翻译前缀一律漏判 → `isBlockedAddress` 返回 false（放行）。
 * 漏掉的三类都是 RFC 明确保留、绝不会作为真实公网主机出现的前缀：
 *   - `::ffff:0:0:0/96`  SIIT / IPv4-translated（RFC 6052 §2.2）
 *   - `64:ff9b::/96`     NAT64 知名前缀（RFC 6052 §2.1）
 *   - `::/96`            IPv4-compatible（已废弃，RFC 4291）
 * 实测 `::ffff:0:7f00:1`（= 127.0.0.1）与 `64:ff9b::a9fe:a9fe`（= 169.254.169.254）
 * 在修复前都被判为「可放行」。
 */
describe('ip-policy：IPv4-in-IPv6 翻译地址不得绕过黑名单', () => {
  const blockedForms = [
    // SIIT ::ffff:0:0:0/96
    ['::ffff:0:7f00:1', '127.0.0.1'],
    ['::ffff:0:0a00:1', '10.0.0.1'],
    ['::ffff:0:a9fe:a9fe', '169.254.169.254'],
    // NAT64 64:ff9b::/96
    ['64:ff9b::7f00:1', '127.0.0.1'],
    ['64:ff9b::a9fe:a9fe', '169.254.169.254'],
    ['64:ff9b::c0a8:1', '192.168.0.1'],
    // IPv4-compatible ::/96（已废弃形态）
    ['::7f00:1', '127.0.0.1'],
    ['::a9fe:a9fe', '169.254.169.254'],
  ] as const;

  it.each(blockedForms)('%s（内嵌 %s）应判为禁止地址', (addr) => {
    expect(isBlockedAddress(addr)).toBe(true);
  });

  it('云元数据地址即使用翻译前缀包裹也硬拒绝', () => {
    expect(isCloudMetadataAddress('169.254.169.254')).toBe(true);
    expect(isCloudMetadataAddress('::ffff:a9fe:a9fe')).toBe(true);
    expect(isCloudMetadataAddress('::ffff:0:a9fe:a9fe')).toBe(true);
    expect(isCloudMetadataAddress('64:ff9b::a9fe:a9fe')).toBe(true);
    expect(isCloudMetadataAddress('fd00:ec2::254')).toBe(true);
  });

  it('翻译前缀里包裹的是公网 IPv4 时必须放行（不能一刀切封掉整个前缀）', () => {
    expect(isBlockedAddress('::ffff:0:808:808')).toBe(false); // 8.8.8.8
    expect(isBlockedAddress('64:ff9b::808:808')).toBe(false);
    expect(isBlockedAddress('::808:808')).toBe(false);
    expect(isCloudMetadataAddress('::ffff:0:808:808')).toBe(false);
    expect(isCloudMetadataAddress('64:ff9b::808:808')).toBe(false);
  });
});

describe('ip-policy：既有判定不回归', () => {
  it('IPv4-mapped 两种写法仍按 IPv4 裁决', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:7f00:1')).toBe(true);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('回环/私网/链路本地/唯一本地/组播仍被拦截', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fe80::1', 'fc00::1', 'ff02::1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('公网地址与真实 IPv6 单播放行', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2001:db8::1', '2606:4700:4700::1111']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it('域名一律返回 false（必须在 DNS 解析后再逐个裁决）', () => {
    for (const host of ['example.com', 'localhost', 'metadata.google.internal', '127.0.0.1.nip.io']) {
      expect(isBlockedAddress(host), host).toBe(false);
    }
  });

  it('方括号形式与 isIpLiteral 判定不受影响', () => {
    expect(isIpLiteral('[::1]')).toBe(true);
    expect(isIpLiteral('[64:ff9b::7f00:1]')).toBe(true);
    expect(isBlockedAddress('[::ffff:0:7f00:1]')).toBe(true);
    expect(isIpLiteral('example.com')).toBe(false);
  });
});
