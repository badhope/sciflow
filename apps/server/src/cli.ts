#!/usr/bin/env node
/**
 * CLI 入口（headless 批处理，对标 Cursor CLI / Cline headless / Codex CLI / GPT-Researcher CLI）
 *
 * 用法（编译后）：
 *   node apps/server/dist/cli.js <command> [options]
 *   sciflow health | project list | pipeline run|status | doc export | chat sessions | mcp serve
 *   sciflow run --topic "研究主题" --auto --out ./paper/          # headless 全流程（C-7.2）
 *
 * `mcp serve` 以 stdio 启动真 MCP Server（官方 @modelcontextprotocol/sdk），
 * 供 Claude Desktop / Cursor 等 MCP 客户端直接接入：
 *   {"mcpServers":{"sciflow":{"command":"node","args":["<repo>/apps/server/dist/cli.js","mcp","serve"]}}}
 *
 * 解析由 commander 承担；HTTP 走原生 fetch（node ≥18 全局可用）。
 * 历史教训：旧版 localApi 用 spawnSync('node',['-e',…]) 拼 URL/JSON 字符串，既是注入面又难维护——已废弃。
 */

import 'dotenv/config';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env') });

import { Command } from 'commander';
import { NestFactory } from '@nestjs/core';

const CLI_VERSION = '1.0.0';

/** 本地服务 REST 客户端（需后端已启动；--base 可覆盖） */
function apiBase(): string {
  return (process.env.SCIFLOW_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
}

async function localApi(path: string, opts?: { method?: string; body?: unknown }): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: opts?.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e: any) {
    throw new Error(`服务不可达（${apiBase()}）：请先启动后端（pnpm dev:server）。详情：${e?.message || e}`);
  }
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON 原样返回 */ }
  if (!res.ok) {
    const msg = typeof data?.message === 'string' ? data.message : (typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data));
    throw new Error(`HTTP ${res.status} ${path}：${msg}`);
  }
  return data;
}

/** 轮询直到任务离开运行态；返回最终任务 JSON */
async function waitForTask(taskId: string, timeoutMs: number, onTick?: (t: any) => void): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let lastStep = '';
  while (Date.now() < deadline) {
    const t = await localApi(`/api/pipeline/${taskId}`);
    const step = `${t.currentStep || ''}:${t.status}`;
    if (step !== lastStep) {
      lastStep = step;
      console.log(`[run] ${t.status} @ ${t.currentStep || '-'}`);
      onTick?.(t);
    }
    if (t.status === 'awaiting_confirmation') return t;
    if (t.status === 'completed' || t.status === 'failed' || t.status === 'interrupted' || t.status === 'stopped') return t;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`等待流水线超时（${Math.round(timeoutMs / 60000)} 分钟）：用 sciflow pipeline status --id ${taskId} 继续跟踪`);
}

let app: any;
/**
 * 惰性创建 Nest 应用上下文（仅 project list / mcp serve 需要）。
 *
 * AppModule 用动态 import：静态导入会在模块加载期就拉起 db/database.ts 的顶层初始化
 * （建表、加载 sqlite-vec），导致 `sciflow --help` 也去建库并往 stdout 打日志。
 */
async function getApp() {
  if (!app) {
    const { AppModule } = await import('./app.module');
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  }
  return app;
}
async function closeApp() {
  if (app) { await app.close(); app = null; }
}

const program = new Command();
program
  .name('sciflow')
  .description('SciFlow CLI — headless 批处理入口')
  .version(CLI_VERSION, '--version', '显示版本');

program
  .command('health')
  .description('健康检查（需后端已启动）')
  .action(async () => {
    try {
      const r = await localApi('/api/health');
      console.log(JSON.stringify(r, null, 2));
      process.exitCode = r?.status === 'ok' ? 0 : 1;
    } catch (e: any) {
      console.error(e.message);
      process.exitCode = 1;
    }
  });

const project = program.command('project').description('项目管理');
project
  .command('list')
  .description('列出所有项目（直读 SQLite，无需后端）')
  .action(async () => {
    const { db } = await import('./db/database');
    const { projects } = await import('./db/schema');
    const list = db.select().from(projects).all();
    console.table(list.map((p: any) => ({ id: p.id, name: p.name, status: p.status })));
  });

const pipeline = program.command('pipeline').description('流水线（LangGraph 编排）');
pipeline
  .command('run')
  .description('创建流水线任务（异步执行；用 pipeline status 跟踪）')
  .requiredOption('--project <id>', '项目 ID')
  .requiredOption('--topic <text>', '研究主题')
  .action(async (opts) => {
    const task = await localApi('/api/pipeline', { method: 'POST', body: { projectId: opts.project, topic: opts.topic } });
    console.log(`[pipeline] 已创建任务 ${task.id}，主题：${opts.topic}`);
    console.log(`[pipeline] 跟踪进度：node cli.js pipeline status --id ${task.id}`);
  });
pipeline
  .command('status')
  .description('查询流水线任务进度')
  .requiredOption('--id <taskId>', '任务 ID')
  .action(async (opts) => {
    const t = await localApi(`/api/pipeline/${opts.id}`);
    console.log(JSON.stringify({
      id: t.id,
      topic: t.topic,
      status: t.status,
      currentStep: t.currentStep,
      retryCount: t.retryCount,
      documentId: t.documentId,
      lastError: t.lastError,
      createdAt: new Date(t.createdAt).toISOString(),
      updatedAt: new Date(t.updatedAt).toISOString(),
    }, null, 2));
  });

const doc = program.command('doc').description('文档导出');
doc
  .command('export')
  .description('导出文档（md 输出到 stdout；docx 输出 Base64）')
  .requiredOption('--doc <id>', '文档 ID')
  .option('--project <id>', '项目 ID（保留参数，导出不需要）')
  .option('--format <fmt>', 'md | docx', 'md')
  .action(async (opts) => {
    if (String(opts.format).toLowerCase() === 'docx') {
      const r = await localApi(`/api/documents/${opts.doc}/export-docx`);
      console.log(r.base64);
    } else {
      const r = await localApi(`/api/documents/${opts.doc}/export`);
      console.log(r.markdown);
    }
  });

const chat = program.command('chat').description('科研问答');
chat
  .command('sessions')
  .description('列出最近对话摘要')
  .requiredOption('--project <id>', '项目 ID')
  .action(async (opts) => {
    const ctx = await getApp();
    const { ChatService } = await import('./chat/chat.service');
    const cs = ctx.get(ChatService);
    const sessions = cs.listSessionSummaries(opts.project);
    console.table(sessions.map((s: any) => ({
      id: s.id.slice(0, 8),
      summary: s.summary ? (s.summary.length > 60 ? s.summary.slice(0, 60) + '…' : s.summary) : '(empty)',
      messages: s.messageCount,
      tokens: s.totalTokens,
      at: new Date(s.createdAt).toLocaleString(),
    })));
    await closeApp();
  });

/** C-7.2 headless 全流程：建项目（可选）→ 建任务 → 自动确认大纲 → 等完成 → 导出产物 */
async function runHeadless(opts: { project?: string; topic: string; auto: boolean; out?: string; depth?: string; timeout: string }) {
  console.log(`[run] 目标服务：${apiBase()}`);
  let projectId = opts.project?.trim() || '';
  if (!projectId) {
    const name = opts.topic.trim().slice(0, 40);
    const created = await localApi('/api/projects', { method: 'POST', body: { name, description: `CLI headless：${new Date().toLocaleString('zh-CN')}` } });
    projectId = created.id;
    console.log(`[run] 已创建项目 ${projectId.slice(0, 8)}…（${name}）`);
  } else {
    await localApi(`/api/projects/${projectId}`);
    console.log(`[run] 使用项目 ${projectId.slice(0, 8)}…`);
  }
  const depth = Math.max(1, Math.min(3, Math.floor(Number(opts.depth) || 1)));
  await localApi('/api/customization/pipeline-settings', { method: 'POST', body: { researchDepth: depth } });
  if (depth > 1) console.log(`[run] 研究深度：${depth}（多轮递归检索）`);

  const task = await localApi('/api/pipeline', { method: 'POST', body: { projectId, topic: opts.topic.trim() } });
  console.log(`[run] 任务 ${task.id.slice(0, 8)}… 已启动`);
  const timeoutMs = Math.max(1, Number(opts.timeout) || 30) * 60_000;
  let final = await waitForTask(task.id, timeoutMs);

  if (final.status === 'awaiting_confirmation') {
    if (!opts.auto) {
      console.log('\n[run] 大纲待人工确认。加 --auto 可自动采用生成的大纲（含反共识变体时自动选主大纲）。');
      console.log(`[run] 也可在网页打开工作台确认；或用 pipeline status --id ${task.id} 查看进度。`);
      process.exitCode = 2;
      return;
    }
    const outlineStep = (final.steps || []).find((s: any) => s.key === 'outline');
    const outline = outlineStep?.output ? JSON.parse(outlineStep.output) : undefined;
    console.log(`[run] --auto：自动确认大纲（${outline?.sections?.length ?? '?'} 章）`);
    await localApi(`/api/pipeline/${task.id}/confirm-outline`, { method: 'POST', body: { outline } });
    // confirm-outline 落库到图真正恢复之间有窗口期，状态可能仍短暂停在 awaiting_confirmation：
    // 先等它离开确认态，再等终态
    const resumeDeadline = Date.now() + 60_000;
    while (Date.now() < resumeDeadline) {
      final = await localApi(`/api/pipeline/${task.id}`);
      if (final.status !== 'awaiting_confirmation') break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    final = await waitForTask(task.id, timeoutMs);
  }
  if (final.status !== 'completed') {
    console.error(`[run] 流水线结束于 ${final.status}：${final.lastError || '(无错误信息)'}`);
    process.exitCode = 2;
    return;
  }
  console.log(`[run] 完成。文档：${final.documentId?.slice(0, 8)}…`);

  if (opts.out) {
    const outDir = opts.out;
    mkdirSync(outDir, { recursive: true });
    const r = await localApi(`/api/documents/${final.documentId}/export`);
    const safeName = (r.title || opts.topic).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'paper';
    const mdPath = join(outDir, `${safeName}.md`);
    writeFileSync(mdPath, r.markdown ?? '', 'utf-8');
    console.log(`[run] 产物已写入 ${mdPath}`);
  }
}

program
  .command('run')
  .description('headless 全流程：研究主题 → 全自动流水线 → 导出 Markdown 论文')
  .requiredOption('--topic <text>', '研究主题')
  .option('--project <id>', '项目 ID（缺省自动新建）')
  .option('--auto', '自动确认大纲（无人值守）', false)
  .option('--depth <1-3>', '研究深度（多轮递归检索轮数）', '1')
  .option('--out <dir>', '产物输出目录（写入 <标题>.md）')
  .option('--timeout <minutes>', '流水线超时（分钟）', '30')
  .action(async (opts) => {
    try {
      await runHeadless(opts);
    } finally {
      await closeApp();
    }
  });

const mcp = program.command('mcp').description('MCP 协议');
mcp
  .command('serve')
  .description('以 stdio 启动真 MCP Server（官方 SDK；供 Claude Desktop 等客户端接入）')
  .action(async () => {
    const ctx = await getApp();
    const { McpService } = await import('./mcp/mcp.service');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const mcps = ctx.get(McpService);
    const server = mcps.buildSdkServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // stderr 输出协议日志（stdout 保留给 JSON-RPC）
    console.error('[sciflow-mcp] stdio server 已就绪，等待客户端握手（Ctrl+C 退出）');
    const shutdown = async () => { try { await server.close(); } finally { await closeApp(); process.exit(0); } };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });

program.parseAsync(process.argv).catch(async (e) => {
  console.error(`命令执行失败：${e?.message || e}`);
  await closeApp();
  process.exit(1);
});
