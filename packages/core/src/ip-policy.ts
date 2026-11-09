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
/** AWS IMDSv2 的 IPv6 端点；存规范化形态，比较时对入参同样规范化 */
const METADATA_V6_HOSTS = new Set(['fd00:ec2::254'].map((a) => canonicalV6(a)).filter((x): x is string => !!x));

const metadataV4 = new net.BlockList();
for (const [base, bits] of METADATA_V4) metadataV4.addSubnet(base, bits, 'ipv4');

/** 去掉 IPv6 方括号与首尾空白，统一小写。 */
function normalize(raw: string): string {
  return raw.trim().replace(/^\[|\]$/g, '');
}

/**
 * 把 IPv6 字面量展开成 8 个 16 位组；非法输入返回 null。
 *
 * 为什么自己展开：原先用正则匹配 `^::ffff:(...)` 这类**固定字面形态**来还原内嵌 IPv4，
 * 只能覆盖 IPv4-mapped 一种前缀，且对压缩写法的变体（前导零、大小写、末尾点分十进制）
 * 很脆弱。展开成定长组之后，「是否属于某个翻译前缀」就变成纯粹的数组比较。
 */
function expandV6(addr: string): number[] | null {
  let s = addr.trim().toLowerCase();
  if (!s || s.includes('%')) return null; // 带 zone id（fe80::1%eth0）的不在此处理
  // 末尾点分十进制（::ffff:1.2.3.4）→ 折成两个 16 位组
  const tail = s.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
  if (tail) {
    const p = tail[1].split('.').map(Number);
    if (p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
    const hi = ((p[0]! << 8) | p[1]!).toString(16);
    const lo = ((p[2]! << 8) | p[3]!).toString(16);
    s = `${s.slice(0, s.length - tail[1].length)}${hi}:${lo}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parseSide = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parseSide(halves[0]!);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = parseSide(halves[1]!);
  if (!rest) return null;
  const fill = 8 - head.length - rest.length;
  if (fill < 0) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...rest];
}

/** 全零区间判定（含端点） */
function allZero(groups: number[], from: number, to: number): boolean {
  for (let i = from; i <= to; i++) if (groups[i] !== 0) return false;
  return true;
}

/**
 * 取出 IPv6 地址里内嵌的 IPv4（若该地址属于任一「IPv4-in-IPv6 翻译前缀」）。
 *
 * 缺陷背景：原实现只认 IPv4-mapped（`::ffff:a.b.c.d` / `::ffff:xxxx:xxxx`）一种形态，
 * 其余把 IPv4 嵌进低 32 位的翻译前缀一律漏判，`isBlockedAddress` 直接返回 false（放行）。
 * 补全的四类都是 RFC 明确保留、绝不会作为真实公网主机出现的前缀：
 *   - `::ffff:0:0/96`      IPv4-mapped（RFC 4291）——原有能力，保持不回归
 *   - `::ffff:0:0:0/96`    SIIT / IPv4-translated（RFC 6052 §2.2）
 *   - `64:ff9b::/32`       NAT64 知名前缀（RFC 6052 §2.1）与 `64:ff9b:1::/48` 本地形态（RFC 8215）
 *   - `::/96`              IPv4-compatible（已废弃，RFC 4291）
 * 实测修复前 `::ffff:0:7f00:1`（= 127.0.0.1）与 `64:ff9b::a9fe:a9fe`（= 169.254.169.254）
 * 都被判为可放行——内网地址与云元数据地址可以借翻译形态绕过黑名单。
 *
 * 注意：只按前缀**还原**出内嵌 IPv4 再走既有裁决，不是「整个前缀一律封」——
 * 前缀里包裹公网 IPv4（如 `::ffff:0:808:808` = 8.8.8.8）时必须放行。
 */
function embeddedV4(groups: number[]): string | null {
  const v4 = `${groups[6]! >>> 8}.${groups[6]! & 255}.${groups[7]! >>> 8}.${groups[7]! & 255}`;
  if (allZero(groups, 0, 4) && groups[5] === 0xffff) return v4; // ::ffff:0:0/96
  if (allZero(groups, 0, 3) && groups[4] === 0xffff && groups[5] === 0) return v4; // ::ffff:0:0:0/96
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) return v4; // 64:ff9b::/32
  if (allZero(groups, 0, 5)) return v4; // ::/96
  return null;
}

/** 规范化 IPv6（展开成 8 组小写十六进制），用于与保留地址常量做等值比较 */
function canonicalV6(addr: string): string | null {
  const g = expandV6(addr);
  return g ? g.map((x) => x.toString(16)).join(':') : null;
}

/**
 * IPv4-in-IPv6 翻译地址还原成 IPv4，否则内网地址可以借翻译形式绕过 IPv4 黑名单。
 */
function unmapV4(addr: string): string | null {
  if (!net.isIPv6(addr)) return null;
  const groups = expandV6(addr);
  return groups ? embeddedV4(groups) : null;
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
  const canonical = canonicalV6(addr);
  return canonical !== null && METADATA_V6_HOSTS.has(canonical);
}

/** 是否为 IP 字面量（IPv4 或 IPv6，含方括号形式）。 */
export function isIpLiteral(host: string): boolean {
  const addr = normalize(host);
  return net.isIPv4(addr) || net.isIPv6(addr);
}
