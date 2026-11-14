/**
 * 字段级脱敏：strict 档下，含密钥/内部路径的字段连「回答」都不允许。
 *
 * 为什么需要：现有权限档只管「能不能改」，管不住「能不能看」。
 * strict 档的语义是「只读且不接触敏感事实」，但 config.snapshot 之类工具仍然
 * 会把 baseUrl / 数据库路径 / 密钥掩码一律吐出。这条规则把这类字段在返回前直接抹掉，
 * 并在工具描述层拒绝「列出密钥」这类请求。
 */

/** 敏感字段名（小写、含子串匹配）：值一律不返回 */
const SENSITIVE_KEY_PATTERNS = [
  /apikey/i,
  /api_key/i,
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /credential/i,
  /privatekey/i,
  /private_key/i,
  /authorization/i,
  /cookie/i,
  /session[_-]?id/i,
  /databasepath/i,
  /dbpath/i,
  /workdir/i,
  /workdir/i,
  /\.env/i,
  /license/i,
];

/** 敏感值形态：即使字段名不敏感，值看起来像密钥也要抹掉 */
const SENSITIVE_VALUE_PATTERNS = [
  /^sk-[A-Za-z0-9_-]{16,}$/, // OpenAI 风格
  /^gh[pousr]_[A-Za-z0-9]{20,}$/, // GitHub token
  /^xox[baprs]-[A-Za-z0-9-]{10,}$/, // Slack
  /^AKIA[0-9A-Z]{16}$/, // AWS
  /^v\d+:[A-Za-z0-9+/=]{20,}$/, // 本项目加密列前缀 v1:...
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export const REDACTED = '[已隐藏]';

function isSensitiveKey(key: string): boolean {
  // 兼容 snake_case / camelCase / 全大写：databasePath / database_path / DATABASEPATH
  const normalized = key.replace(/[_-]/g, '').toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key) || re.test(normalized));
}

function isSensitiveValue(value: unknown): boolean {
  return typeof value === 'string' && SENSITIVE_VALUE_PATTERNS.some((re) => re.test(value.trim()));
}

/**
 * 递归脱敏。返回新对象，不修改入参。
 * 数组逐项处理；循环引用用 WeakSet 防爆栈。
 */
export function redactSensitive(input: unknown, seen = new WeakSet<object>()): unknown {
  if (input === null || typeof input !== 'object') {
    return isSensitiveValue(input) ? REDACTED : input;
  }
  if (seen.has(input as object)) return '[循环引用]';
  seen.add(input as object);

  if (Array.isArray(input)) return input.map((v) => redactSensitive(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : redactSensitive(v, seen);
  }
  return out;
}

/** 文本级脱敏：抹掉形似密钥的片段（用于日志、导出、LLM 上下文） */
export function redactText(text: string): string {
  let out = String(text ?? '');
  for (const re of [/sk-[A-Za-z0-9_-]{16,}/g, /gh[pousr]_[A-Za-z0-9]{20,}/g, /v\d+:[A-Za-z0-9+/=]{20,}/g]) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

/**
 * 该工具/字段组合在给定权限档下是否允许「看」。
 * strict：一律不允许看敏感字段（返回值整体脱敏）；
 * workspace / full：允许（写入仍走审批）。
 */
export function shouldRedactForMode(mode: string): boolean {
  return mode === 'strict';
}
