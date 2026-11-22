/**
 * 工具安全元数据：Agent harness 与 MCP 协议端点共用一份判定。
 *
 * 只读工具可以安全重试（相同参数不会产生第二份副作用），也会在 MCP tools/list
 * 中带 readOnlyHint；写工具不自动重试，避免“请求已成功但响应丢失”时重复落库。
 */
const READ_ONLY_TOOLS = new Set<string>([
  'code.diagnostics',
  'project.list',
  'project.get',
  'document.list',
  'document.get',
  'quality.overview',
  'quality.history',
  'experiment.list',
  'experiment.get',
  'memory.search',
  'research.brief.get',
  'research.plan_audit',
  'literature.search',
  'literature.discover',
  'knowledge.query',
  'references.evidence',
  'submission.track',
  'submission.readiness',
  'config.snapshot',
  'extension.list',
  'mcp.external.list',
]);

/** 外部/开放式工具：结果受网络与第三方状态影响，重试只应发生在明确的瞬时错误上。 */
const OPEN_WORLD_TOOLS = new Set<string>([
  'literature.search',
  'literature.discover',
  'research.novelty',
  'research.expert',
  'submission.match',
  'browser.open',
  'browser.text',
  'browser.verify',
  'browser.close',
  'mcp.external.call',
]);

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

export function isOpenWorldTool(name: string): boolean {
  return OPEN_WORLD_TOOLS.has(name);
}

/**
 * 只对“换一次就可能成功”的错误重试。参数错误、权限拒绝、404、业务校验失败都不重试，
 * 否则会把用户的审批/等待时间浪费在确定性失败上。
 */
export function isRetryableToolError(message: string): boolean {
  return /(?:timed?\s*out|timeout|超时|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network error|temporarily unavailable|service unavailable|too many requests|rate limit|overloaded|429|502|503|504)/i.test(
    message,
  );
}
