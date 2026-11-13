import { Controller, Get, Post, Body, Param, Req, Res, All } from '@nestjs/common';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpService } from './mcp.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

@Controller('mcp')
export class McpController {
  constructor(
    private readonly mcp: McpService,
    private readonly access: ProjectAccessService,
  ) {}

  /** MCP 协议信息 */
  @Get('info')
  info() {
    return {
      protocol: 'model-context-protocol',
      version: '2026-07-28',
      name: 'sciflow-mcp',
      tools: this.mcp.list().length,
    };
  }

  /** 工具清单（MCP tools/list） */
  @Get('tools')
  tools() {
    return {
      tools: this.mcp.list(),
    };
  }

  /** 调用工具（MCP tools/call） */
  @Post('call')
  call(@Body() body: { name: string; arguments?: Record<string, any> }, @Req() req: { user?: AuthPayload }) {
    return this.mcp.call(body?.name, body?.arguments, req.user);
  }

  // ---------- 官方 MCP 协议端点（Streamable HTTP，供 Claude Desktop 等真 MCP 客户端接入） ----------

  /**
   * MCP 协议入口：POST /api/mcp/rpc（无状态 Streamable HTTP）。
   * 客户端配置示例：{"mcpServers":{"sciflow":{"url":"http://127.0.0.1:3000/api/mcp/rpc"}}}
   */
  @All('rpc')
  async rpc(@Req() req: Request & { user?: AuthPayload }, @Res() res: Response) {
    const server = this.mcp.buildSdkServer(req.user);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  /** 已配置的外部 MCP 服务器（实例级配置，企业模式仅管理员） */
  @Get('external')
  externalServers(@Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    return this.mcp.listExternalServers();
  }

  /** 探测外部 MCP 服务器（实例级配置，企业模式仅管理员） */
  @Post('external/discover')
  discover(@Body() body: { url: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    return this.mcp.discoverExternal(body?.url);
  }

  /** 调用外部 MCP 工具（实例级配置，企业模式仅管理员） */
  @Post('external/:id/call')
  callExternal(
    @Param('id') id: string,
    @Body() body: { name: string; arguments?: Record<string, any> },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertAdmin(req.user);
    return this.mcp.callExternal(id, body?.name, body?.arguments || {});
  }
}
