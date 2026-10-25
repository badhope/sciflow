/**
 * API barrel（原 551 行单体 client.ts 已按域拆分）：
 *  - core.ts     HTTP 基础设施 + 错误转译 + SSE streamChat
 *  - writing.ts  documents / pipeline / chat / memory / dashboard
 *  - research.ts references / knowledge / research / quality / judgment / customization
 *  - platform.ts auth / settings / usage / mcp / mcpExternal / experiments / submission
 *  - agent.ts    Agent 执行追踪（executions / getRun / usageTrend）
 * 对外 API 形状与拆分前完全一致（现有 import 不受影响）。
 */
import { writing } from './writing';
import { research } from './research';
import { platform } from './platform';
import { agent } from './agent';

export const api = {
  ...writing,
  ...research,
  ...platform,
  agent,
};
export { streamChat, getToken, setToken } from './core';
