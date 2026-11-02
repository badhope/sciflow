/** IPv4/IPv6 出站地址分类（纯函数，服务端守卫与 AI 能力层共用同一口径）。 */
import net from 'node:net';

const BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const;

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inCidrV4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

function canonicalIpv6(addr: string): string {
  try {
    return new URL(`http://[${addr}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return addr.toLowerCase();
  }
}

/** 判断已解析 IP 是否属于默认禁止范围（回环/私网/链路本地/保留/组播）。 */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.trim().replace(/^\[|\]$/g, '');
  if (net.isIPv4(addr)) return BLOCKED_V4.some(([base, bits]) => inCidrV4(addr, base, bits));
  if (net.isIPv6(addr)) {
    const lower = canonicalIpv6(addr);
    const mapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      return isBlockedAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff')) return true;
    const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isBlockedAddress(dotted[1]);
    return false;
  }
  return true;
}

/** 云元数据地址硬拒绝：即使显式允许私网也不放行。 */
export function isCloudMetadataAddress(ip: string): boolean {
  const addr = ip.trim().replace(/^\[|\]$/g, '');
  if (net.isIPv4(addr)) return inCidrV4(addr, '169.254.0.0', 16);
  if (!net.isIPv6(addr)) return false;
  const canonical = canonicalIpv6(addr);
  return canonical === 'fd00:ec2::254' || /^::ffff:a9fe:[0-9a-f]{1,4}$/.test(canonical);
}
