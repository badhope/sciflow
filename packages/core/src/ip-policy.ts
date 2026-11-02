/**
 * 出站地址分类（纯函数，服务端守卫与 AI 能力层共用同一口径）。
 *
 * 用 Node 内置 `net.BlockList` 表达 CIDR，避免手写位运算在 IPv6 / 边界前缀上出错。
 * 语义约定：`isBlockedAddress` 只接受 **IP 字面量**；域名一律返回 false，
 * 由调用方在 DNS 解析后对每个地址再次裁决（连接级校验，阻 DNS rebinding）。
 */
import net from 'node:net';

/** IPv4 默认禁止段：本网络/私网/回环/链路本地/保留/文档/组播。 */
const BLOCKED_V4_SUBNETS: ReadonlyArray<readonly [string, number]> = [
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
];

/** IPv6 默认禁止段：未指定/回环/链路本地 fe80::/10/唯一本地 fc00::/7/组播 ff00::/8。 */
const BLOCKED_V6_SUBNETS: ReadonlyArray<readonly [string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['fe80::', 10],
  ['fc00::', 7],
  ['ff00::', 8],
];

const blockedV4 = new net.BlockList();
for (const [base, bits] of BLOCKED_V4_SUBNETS) blockedV4.addSubnet(base, bits, 'ipv4');

const blockedV6 = new net.BlockList();
for (const [base, bits] of BLOCKED_V6_SUBNETS) blockedV6.addSubnet(base, bits, 'ipv6');

/** 云元数据固定地址：即使显式放行私网也不放行。 */
const METADATA_V4: ReadonlyArray<readonly [string, number]> = [['169.254.0.0', 16]];
const METADATA_V6_HOSTS = new Set(['fd00:ec2::254']);

const metadataV4 = new net.BlockList();
for (const [base, bits] of METADATA_V4) metadataV4.addSubnet(base, bits, 'ipv4');

/** 去掉 IPv6 方括号与首尾空白，统一小写。 */
function normalize(raw: string): string {
  return raw.trim().replace(/^\[|\]$/g, '');
}

/**
 * IPv4-mapped IPv6（::ffff:a.b.c.d 与 ::ffff:xxxx:xxxx）还原成 IPv4，
 * 否则内网地址可以借映射形式绕过 IPv4 黑名单。
 */
function unmapV4(addr: string): string | null {
  if (!net.isIPv6(addr)) return null;
  let canonical: string;
  try {
    canonical = new URL(`http://[${addr}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    canonical = addr.toLowerCase();
  }
  const dotted = canonical.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return null;
}

/**
 * 判断地址是否属于默认禁止范围（回环/私网/链路本地/保留/组播）。
 *
 * @param ip IP 字面量。传入域名返回 false —— 域名必须在解析后再判定，
 *           在字符串阶段判定会把所有正常公网域名误杀。
 */
export function isBlockedAddress(ip: string): boolean {
  const addr = normalize(ip);
  const mapped = unmapV4(addr);
  if (mapped) return isBlockedAddress(mapped);
  if (net.isIPv4(addr)) return blockedV4.check(addr, 'ipv4');
  if (net.isIPv6(addr)) return blockedV6.check(addr, 'ipv6');
  return false;
}

/** 云元数据地址硬拒绝：即使显式允许私网也不放行。 */
export function isCloudMetadataAddress(ip: string): boolean {
  const addr = normalize(ip);
  const mapped = unmapV4(addr);
  if (mapped) return isCloudMetadataAddress(mapped);
  if (net.isIPv4(addr)) return metadataV4.check(addr, 'ipv4');
  if (!net.isIPv6(addr)) return false;
  let canonical: string;
  try {
    canonical = new URL(`http://[${addr}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    canonical = addr.toLowerCase();
  }
  return METADATA_V6_HOSTS.has(canonical);
}

/** 是否为 IP 字面量（IPv4 或 IPv6，含方括号形式）。 */
export function isIpLiteral(host: string): boolean {
  const addr = normalize(host);
  return net.isIPv4(addr) || net.isIPv6(addr);
}
