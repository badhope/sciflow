/**
 * SSRF 防护（出站请求守卫）
 *
 * 威胁模型：本地/单用户应用默认只监听回环，但当用户把服务暴露到内网（HOST=0.0.0.0 +
 * AUTH_MODE=jwt），或桌面端被诱导点击时，出站请求的 URL 由用户输入控制
 * （SearXNG 实例地址、外部 MCP 服务器地址），攻击者可借它探测内网、读取云厂商元数据
 * （169.254.169.254）、访问本机管理端口。
 *
 * 地址分类统一委托 `packages/core/src/ip-policy`（单一真相）：
 *  - 默认拒绝：回环、私有网段、链路本地（含云元数据）、保留段、组播、未指定地址
 *  - 允许显式放行（ALLOW_PRIVATE_OUTBOUND=1）：本地自建 SearXNG / 内网 MCP 场景
 *  - DNS 解析后再校验一次：防 DNS rebinding
 *
 * 注意：无法完全消除 TOCTOU（解析与连接之间 DNS 可能变化），因此真正的连接由
 * `packages/ai/src/safe-outbound` 在 socket lookup 阶段再裁决一次；
 * 本模块用于「保存配置 / 激活 provider」等前置校验，给出可读的中文原因。
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import { isBlockedAddress, isCloudMetadataAddress } from '../../../../packages/core/src/ip-policy';

export { isBlockedAddress, isCloudMetadataAddress };

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

  // 1) 字面量 IP 直接判定
  if (net.isIP(host)) {
    if (isCloudMetadataAddress(host)) return { ok: false, reason: '禁止访问内网云元数据地址' };
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
  if (records.some((r) => isCloudMetadataAddress(r.address))) {
    return { ok: false, reason: '禁止访问内网云元数据地址' };
  }
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
