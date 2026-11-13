/**
 * JSON 解析安全守卫（全项目统一来源，替代散布各处的 try-catch JSON.parse 模板）
 *
 * 用法：
 *   parseJson<OutineBlock[]>(doc.outline, [])
 *   parseStringList(row.keywords)
 *   parseTagsJson(tags)          // 等价于 parseStringList(tags)
 */

/** 安全解析 JSON 字符串为指定类型数组；解析失败或类型不匹配返回 fallback（默认空数组） */
function parseJsonArray<T = string>(json: string | null | undefined, fallback: T[] = [] as any): T[] {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed.map((x: unknown) => x as T) : fallback;
  } catch {
    return fallback;
  }
}

/** 安全解析 DB JSON 字段为对象（带类型守卫）；解析失败返回 fallback */
export function parseJson<T = unknown>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 安全解析 DB JSON 字段为 string[]；解析失败返回空数组 */
export function parseStringList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 安全解析 tags JSON 字符串 → string[]。
 *
 * 历史缺陷：直接返回 `parseJsonArray<string>` 的结果，而后者只做 `x as T` 的**类型断言**、
 * 不做运行时转换。于是 `'[1,2]'` → `[1,2]`、`'[null]'` → `[null]`，返回值在类型上是
 * `string[]`、运行时却是数字/null。这些值会原样进 graph() 等 API 响应，前端一旦调用
 * `tag.trim()` / `tag.toLowerCase()` 就抛 TypeError —— 类型系统看不出、测试也难覆盖。
 *
 * 现在：只保留可安全转成字符串的标量（字符串/数字/布尔），丢弃 null 与对象/数组，
 * 并过滤空串。文档承诺的「等价于 parseStringList」由此成立（且比 `map(String)` 更安全：
 * 不会把 null 变成字面量 "null"）。
 */
export function parseTagsJson(tags: string | null | undefined): string[] {
  const raw = parseJsonArray<unknown>(tags, []);
  const out: string[] = [];
  for (const x of raw) {
    if (x === null || x === undefined) continue;
    const t = typeof x;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') continue;
    const s = String(x).trim();
    if (s) out.push(s);
  }
  return out;
}

/**
 * 严格校验：raw 是否为「JSON 数组且元素全为字符串」。
 *
 * 用于写入前的入参校验。此前 references 服务用
 * `parseTagsJson(x).length === 0 && x.trim().length > 2` 这种**长度启发式**判非法 JSON，
 * 漏网两类脏输入：`'{}'` / `'ab'`（长度 ≤ 2 → 直接放行落库）、`'[1,2]'`（解析出 2 个元素 →
 * 放行，但落库的是非字符串数组）。改为结构化判定后，落库的 tags 必然是 string[]。
 */
export function isJsonStringArray(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string');
}
