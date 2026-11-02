import { describe, expect, it } from 'vitest';
import { pickAllowedAddresses } from './safe-outbound';

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
