import { describe, expect, it } from 'vitest';
import { checkOutboundUrl, isBlockedAddress } from './outbound-guard';

/**
 * SSRF 出站守卫测试。
 *
 * 背景（2026-10 安全审计）：SearXNG 实例地址与外部 MCP 服务器 URL 完全由用户输入，
 * 且服务端直接 fetch / 建立 MCP 连接 —— 实测可请求 http://127.0.0.1:3000/api/health
 * 与 http://169.254.169.254/latest/meta-data/（云元数据）。修复后必须逐条守住。
 */

describe('isBlockedAddress', () => {
  it('拒绝回环 / 私有 / 链路本地 / 元数据地址', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('放行公网地址', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it('拒绝 IPv6 回环/链路本地/唯一本地/组播', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('IPv4-mapped IPv6 按内层 IPv4 判定', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
    expect(isBlockedAddress('::ffff:7f00:1')).toBe(true);
    expect(isBlockedAddress('::ffff:a9fe:a9fe')).toBe(true);
    expect(isBlockedAddress('::ffff:808:808')).toBe(false);
  });

  it('无法解析的字符串按危险处理（fail-closed）', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('checkOutboundUrl', () => {
  it('拒绝非 http(s) 协议', async () => {
    expect((await checkOutboundUrl('file:///etc/passwd')).ok).toBe(false);
    expect((await checkOutboundUrl('javascript:alert(1)')).ok).toBe(false);
  });

  it('拒绝内嵌凭据的 URL', async () => {
    const r = await checkOutboundUrl('http://user:pass@example.com/');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('用户名或密码');
  });

  it('拒绝字面量内网地址（含云元数据）', async () => {
    for (const url of ['http://127.0.0.1:3000/api/health', 'http://169.254.169.254/latest/meta-data/', 'http://192.168.1.1/', 'http://[::1]:8080/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/']) {
      const r = await checkOutboundUrl(url);
      expect(r.ok, url).toBe(false);
      expect(r.reason, url).toMatch(/内网|保留/);
    }
  });

  it('allowPrivate=true 时放行本地自建 SearXNG（显式开关）', async () => {
    const r = await checkOutboundUrl('http://127.0.0.1:8080/search', { allowPrivate: true });
    expect(r.ok).toBe(true);
  });

  it('即使允许私网也拒绝云元数据地址', async () => {
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://[fd00:ec2::254]/']) {
      expect((await checkOutboundUrl(url, { allowPrivate: true })).ok).toBe(false);
    }
  });

  it('公网地址放行', async () => {
    const r = await checkOutboundUrl('https://example.com/api');
    expect(r.ok).toBe(true);
    expect(r.addresses?.length).toBeGreaterThan(0);
  });

  it('非法 URL 给出可读原因', async () => {
    const r = await checkOutboundUrl('not a url');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('合法 URL');
  });
});
