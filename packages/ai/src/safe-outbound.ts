import { Agent, fetch as undiciFetch } from 'undici';
import type { RequestInfo, RequestInit } from 'undici';
import { lookup as dnsLookup } from 'node:dns';
import { isBlockedAddress, isCloudMetadataAddress, isIpLiteral } from '../../core/src/ip-policy';

/**
 * 连接级出站传输（打包层共用）。
 *
 * 安全边界不在 URL 字符串预检，而在**建立 socket 时**：
 * - DNS 结果在 connect 阶段再次校验，阻 DNS rebinding；
 * - 私网/回环/保留地址默认拒绝，云元数据地址无条件拒绝；
 * - 不跟随重定向，避免公网 302 跳到内网；
 * - HTTPS 保留原 hostname 做 TLS 证书校验（只换解析结果，不改 servername）。
 *
 * ALLOW_PRIVATE_OUTBOUND=1 可显式放行本地 Ollama / 内网网关，但元数据地址永远拒绝。
 */

export interface OutboundOptions {
  allowPrivate?: boolean;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

/**
 * 连接时地址裁决（纯函数，供 connect lookup 与单测共用）。
 * 返回 null 表示拒绝；调用方必须 fail-closed，不允许「拿不到结果就放行」。
 */
export function pickAllowedAddresses(
  hostname: string,
  records: ResolvedAddress[],
  allowPrivate: boolean,
): ResolvedAddress[] | null {
  if (!records.length) return null;
  const denied = records.find((entry) => isCloudMetadataAddress(entry.address) || (!allowPrivate && isBlockedAddress(entry.address)));
  if (denied) return null;
  void hostname;
  return records;
}

function resolveAllowed(hostname: string, allowPrivate: boolean): Promise<ResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, records) => {
      if (err) {
        reject(new Error(`出站域名解析失败：${hostname}`));
        return;
      }
      const list = Array.isArray(records) ? records : [];
      const allowed = pickAllowedAddresses(hostname, list, allowPrivate);
      if (!allowed) {
        reject(new Error(`出站地址被安全策略拒绝：${hostname}`));
        return;
      }
      resolve(allowed);
    });
  });
}

function createGuardedAgent(allowPrivate: boolean): Agent {
  const connectorLookup = (
    hostname: string,
    options: { family?: number; all?: boolean },
    callback: (err: Error | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void,
  ): void => {
    resolveAllowed(hostname, allowPrivate)
      .then((list) => {
        if (options.all) callback(null, list);
        else callback(null, list[0].address, list[0].family);
      })
      .catch((error: Error) => callback(error));
  };
  return new Agent({ connect: { lookup: connectorLookup as never } });
}

const agents = new Map<boolean, Agent>([
  [false, createGuardedAgent(false)],
  [true, createGuardedAgent(true)],
]);

export function allowPrivateFromEnv(): boolean {
  return process.env.ALLOW_PRIVATE_OUTBOUND === '1';
}

/** 统一的受控 fetch；所有模型、目录、embedding 出站必须经由它。 */
export async function safeOutboundFetch(
  input: string | URL | globalThis.Request,
  init: globalThis.RequestInit = {},
  opts: OutboundOptions = {},
): Promise<globalThis.Response> {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('出站地址不是合法 URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('出站仅支持 http/https');
  if (parsed.username || parsed.password) throw new Error('出站地址不允许内嵌用户名或密码');
  const allowPrivate = opts.allowPrivate ?? allowPrivateFromEnv();
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  // AI_MOCK=1 时 mock 网关由 MSW 进程内拦截（不建真实 socket），仅允许该保留域名，其他地址照常校验。
  if (process.env.AI_MOCK === '1' && host === 'mock.local') {
    return globalThis.fetch(input as unknown as string | URL, init as globalThis.RequestInit) as Promise<globalThis.Response>;
  }
  if (isCloudMetadataAddress(host)) throw new Error('出站地址被安全策略拒绝：云元数据地址');
  // 域名不在此处判定：isBlockedAddress 只对 IP 字面量有意义，对域名应放行到连接级 DNS 复核。
  if (isIpLiteral(host) && isBlockedAddress(host) && !allowPrivate) {
    throw new Error(`出站地址被安全策略拒绝：内网/保留地址 ${host}`);
  }
  if (!isIpLiteral(host)) await resolveAllowed(host, allowPrivate);
  return undiciFetch(input as RequestInfo, {
    ...(init as RequestInit),
    dispatcher: agents.get(allowPrivate) as never,
    redirect: 'manual',
  }) as unknown as Promise<globalThis.Response>;
}
