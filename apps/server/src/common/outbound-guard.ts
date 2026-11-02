/**
 * SSRF 防护（出站请求守卫）
 *
 * 威胁模型：本地/单用户应用默认只监听回环，但当用户把服务暴露到内网（HOST=0.0.0.0 +
 * AUTH_MODE=jwt），或桌面端被诱导点击时，出站请求的 URL 由用户输入控制
 * （SearXNG 实例地址、外部 MCP 服务器地址），攻击者可借它探测内网、读取云厂商元数据
 * （169.254.169.254）、访问本机管理端口。
 *
 * 本模块只做「地址分类 + 校验」，不改变调用方的业务逻辑：
 *  - 默认拒绝：回环、私有网段、链路本地（含云元数据）、保留段、组播、未指定地址
 *  - 允许显式放行（ALLOW_PRIVATE_OUTBOUND=1）：本地自建 SearXNG / 内网 MCP 场景
 *  - DNS 解析后再校验一次：防 DNS rebinding（域名首次解析到公网，二次解析到内网）
 *
 * 注意：无法完全消除 TOCTOU（解析与连接之间 DNS 可能变化），因此对高危目标
 * （云元数据地址）做硬拒绝，且调用方仍需设置超时。
 */

import dns from 'node:dns/promises';
import net from 'node:net';

/** 明确禁止的 IPv4 网段（含云元数据 169.254.0.0/16） */
const BLOCKED_V4 = [
  ['0.0.0.0', 8], // 本网络
  ['10.0.0.0', 8], // 私有
  ['100.64.0.0', 10], // 运营商级 NAT
  ['127.0.0.0', 8], // 回环
  ['169.254.0.0', 16], // 链路本地 / 云元数据
  ['172.16.0.0', 12], // 私有
  ['192.0.0.0', 24], // IETF 协议分配
  ['192.0.2.0', 24], // 文档
  ['192.168.0.0', 16], // 私有
  ['198.18.0.0', 15], // 基准测试
  ['198.51.100.0', 24], // 文档
  ['203.0.113.0', 24], // 文档
  ['224.0.0.0', 4], // 组播
  ['240.0.0.0', 4], // 保留
] as const;

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inCidrV4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

/** 判断一个已解析的 IP 字面量是否属于禁止访问范围 */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.trim().replace(/^\[|\]$/g, '');
  if (net.isIPv4(addr)) {
    return BLOCKED_V4.some(([base, bits]) => inCidrV4(addr, base, bits));
  }
  if (net.isIPv6(addr)) {
    const lower = new URL(`http://[${addr}]/`).hostname.slice(1, -1).toLowerCase();
    const mapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      return isBlockedAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80')) return true; // 链路本地
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // 唯一本地
    if (lower.startsWith('ff')) return true; // 组播
    // IPv4 映射（::ffff:127.0.0.1）
    const m = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isBlockedAddress(m[1]);
    return false;
  }
  // 无法判定：按危险处理（fail-closed）
  return true;
}

export interface OutboundCheckResult {
  ok: boolean;
  /** 失败原因（面向用户的中文） */
  reason?: string;
  /** 解析到的地址（ok=true 时有值） */
  addresses?: string[];
}

/**
 * 校验出站 URL 是否允许访问。
 * @param rawUrl 用户提供的 URL
 * @param opts.allowPrivate 显式允许私有网段（本地自建服务场景）
 */
export async function checkOutboundUrl(
  rawUrl: string,
  opts: { allowPrivate?: boolean } = {},
): Promise<OutboundCheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: '地址不是合法 URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: '仅支持 http:// 或 https:// 地址' };
  }
  // 带凭据的 URL 常用于绕过校验后窃取凭据，一律拒绝
  if (parsed.username || parsed.password) {
    return { ok: false, reason: '地址中不允许内嵌用户名或密码' };
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const isMetadata = (address: string) => {
    const normalized = address.toLowerCase();
    if (net.isIPv4(normalized)) return inCidrV4(normalized, '169.254.0.0', 16);
    if (net.isIPv6(normalized)) {
      const canonical = new URL(`http://[${normalized}]/`).hostname.slice(1, -1);
      return canonical === 'fd00:ec2::254' || /^::ffff:a9fe:[0-9a-f]{1,4}$/.test(canonical);
    }
    return false;
  };
  // 1) 字面量 IP 直接判定
  if (net.isIP(host)) {
    if (isMetadata(host)) return { ok: false, reason: '禁止访问内网云元数据地址' };
    if (isBlockedAddress(host) && !opts.allowPrivate) {
      return { ok: false, reason: `禁止访问内网/保留地址：${host}` };
    }
    return { ok: true, addresses: [host] };
  }

  // 2) 域名：解析后逐个判定（防 DNS rebinding）
  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: `域名无法解析：${host}` };
  }
  if (!records.length) return { ok: false, reason: `域名无解析结果：${host}` };
  if (records.some((r) => isMetadata(r.address))) return { ok: false, reason: '禁止访问内网云元数据地址' };
  const blocked = records.find((r) => isBlockedAddress(r.address));
  if (blocked && !opts.allowPrivate) {
    return { ok: false, reason: `域名 ${host} 解析到内网/保留地址 ${blocked.address}，已拒绝` };
  }
  return { ok: true, addresses: records.map((r) => r.address) };
}

/** 便捷布尔版：不关心原因时使用 */
export async function isOutboundAllowed(rawUrl: string, opts: { allowPrivate?: boolean } = {}): Promise<boolean> {
  return (await checkOutboundUrl(rawUrl, opts)).ok;
}

/** 是否显式允许私有网段出站（本地自建 SearXNG / 内网 MCP 常用） */
export function allowPrivateOutbound(): boolean {
  return process.env.ALLOW_PRIVATE_OUTBOUND === '1';
}
