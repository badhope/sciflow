import { describe, expect, it } from 'vitest';
import { pickAllowedAddresses } from './safe-outbound';
import { isBlockedAddress, isCloudMetadataAddress, isIpLiteral } from '../../core/src/ip-policy';

/**
 * DNS rebinding 判定的纯函数回归。
 * 连接 lookup 与预检共用同一裁决：只要任一解析结果为内网/保留/元数据地址即拒绝，
 * 且 allowPrivate 不得放行云元数据。
 */
describe('pickAllowedAddresses（连接级 DNS 裁决）', () => {
  it('全部公网地址才放行', () => {
    expect(pickAllowedAddresses('example.com', [{ address: '93.184.216.34', family: 4 }], false)).toHaveLength(1);
  });

  it('解析结果混入内网地址时整体拒绝（防 DNS 轮询/重绑定）', () => {
    const records = [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    expect(pickAllowedAddresses('evil.example', records, false)).toBeNull();
  });

  it('IPv4-mapped IPv6 回环与私网按内部 IPv4 拒绝', () => {
    for (const address of ['::ffff:7f00:1', '::ffff:0a00:0001']) {
      const result = pickAllowedAddresses('evil.example', [{ address, family: 6 }], false);
      expect(result).toBeNull();
    }
  });

  it('显式允许私网时可放行内网地址，但云元数据地址永远拒绝', () => {
    expect(pickAllowedAddresses('ollama.local', [{ address: '127.0.0.1', family: 4 }], true)).toHaveLength(1);
    expect(pickAllowedAddresses('metadata.example', [{ address: '169.254.169.254', family: 4 }], true)).toBeNull();
    expect(pickAllowedAddresses('metadata.example', [{ address: 'fd00:ec2::254', family: 6 }], true)).toBeNull();
  });

  it('空解析结果 fail-closed', () => {
    expect(pickAllowedAddresses('empty.example', [], false)).toBeNull();
  });
});

/**
 * 地址分类的边界回归。
 * 这些用例存在的原因：初版把域名也送进 isBlockedAddress（该函数对非 IP 返回 true），
 * 导致所有真实模型域名出站被误拒，而单测只覆盖 IP 字面量所以没发现。
 */
describe('isBlockedAddress（IP 字面量分类）', () => {
  it('域名不是 IP 字面量，必须放行给连接级 DNS 复核', () => {
    for (const host of ['api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'example.com']) {
      expect(isIpLiteral(host)).toBe(false);
      expect(isBlockedAddress(host)).toBe(false);
    }
  });

  it('公网 IPv4 / IPv6 放行', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });

  it('私网/回环/链路本地/保留 IPv4 拒绝', () => {
    for (const ip of ['0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.5', '192.168.1.1', '198.18.0.1', '224.0.0.1', '240.0.0.1']) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it('IPv6 链路本地整段 fe80::/10 拒绝（不是只匹配 fe80 前缀）', () => {
    for (const ip of ['fe80::1', 'fe90::1', 'fea0::1', 'febf::1']) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
    // 相邻的 fec0::/10 不在链路本地范围内，不应误伤
    expect(isBlockedAddress('fec0::1')).toBe(false);
  });

  it('IPv6 唯一本地 / 组播 / 回环拒绝', () => {
    for (const ip of ['::1', '::', 'fd00::1', 'fc00::1', 'ff02::1']) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it('IPv4-mapped IPv6 按内部 IPv4 判定', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:192.168.1.1')).toBe(true);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('isCloudMetadataAddress（元数据地址硬拒绝）', () => {
  it('识别 IPv4 链路本地与 IPv6 元数据端点', () => {
    expect(isCloudMetadataAddress('169.254.169.254')).toBe(true);
    expect(isCloudMetadataAddress('fd00:ec2::254')).toBe(true);
    expect(isCloudMetadataAddress('::ffff:169.254.169.254')).toBe(true);
  });

  it('普通公网地址与域名不误判', () => {
    expect(isCloudMetadataAddress('8.8.8.8')).toBe(false);
    expect(isCloudMetadataAddress('api.openai.com')).toBe(false);
  });
});
