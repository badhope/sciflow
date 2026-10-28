import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { ProjectAccessService } from '../common/project-access.service';
import { AdminGuard } from '../auth/admin.guard';

/**
 * 设置 API（模型厂商 / Key / 连接测试 / 环境自检）。
 *
 * v1.8 安全：这些是**实例级**配置——任一 member 能改 baseURL 就能把全实例的
 * 请求（含他人稿件）引到自己的服务器；也能改模型导致他人调用失败/超费。
 * 企业模式（AUTH_MODE=jwt）下整个控制器要求 admin；本地模式 AdminGuard 直接放行。
 *
 * 读接口同样收紧：`GET /settings` 会回显 baseUrl / 模型清单 / 数据源，
 * 属于实例配置信息，非管理员无需知道。
 */
@Controller('settings')
@UseGuards(AdminGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly access: ProjectAccessService,
  ) {}

  /** 应用配置总览（AI 配置/模型列表/环境/数据源） */
  @Get()
  getSettings() {
    return this.settings.getSettings();
  }

  /** 环境自检：数据库 + AI 连通性 */
  @Get('check')
  selfCheck() {
    return this.settings.selfCheck();
  }

  /** 指定模型连接测试 */
  @Post('test')
  testModel(@Body() body: { model?: string }) {
    return this.settings.testModel(body.model || '');
  }

  // ---------- 模型厂商管理（LiteLLM 式多厂商） ----------
  @Get('providers')
  listProviders() {
    return this.settings.listProviders();
  }

  @Post('providers')
  saveProvider(@Body() body: {
    id?: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
    model: string;
    protocol?: string;
    contextWindow?: number;
    maxOutput?: number;
    toolCalling?: number | boolean;
    models?: { id: string; displayName?: string; contextWindow?: number; maxOutput?: number; toolCalling?: boolean }[];
  }) {
    return this.settings.saveProvider(body);
  }

  /** 检测模型：表单地址 + Key 实时拉取模型目录（不落库） */
  @Post('providers/discover')
  discoverModels(@Body() body: { id?: string; baseUrl: string; apiKey?: string; protocol?: string; privateOk?: boolean }) {
    return this.settings.discoverModels(body);
  }

  /** 连接测试：表单当前协议/地址/Key/模型发最小消息，不保存、不切换 */
  @Post('providers/test')
  testProvider(@Body() body: { id?: string; baseUrl: string; apiKey?: string; protocol?: string; model: string; maxOutput?: number; privateOk?: boolean }) {
    return this.settings.testProvider(body);
  }

  @Post('providers/:id/activate')
  activateProvider(@Param('id') id: string) {
    return this.settings.activateProvider(id);
  }

  @Delete('providers/:id')
  removeProvider(@Param('id') id: string) {
    return this.settings.removeProvider(id);
  }

  // ---------- 外部 MCP 服务器 ----------
  @Get('mcp-servers')
  listMcpServers() {
    return this.settings.listMcpServers();
  }

  @Post('mcp-servers')
  saveMcpServer(@Body() body: { id?: string; name: string; url: string; enabled?: number }) {
    return this.settings.saveMcpServer(body);
  }

  @Delete('mcp-servers/:id')
  removeMcpServer(@Param('id') id: string) {
    return this.settings.removeMcpServer(id);
  }

  // ---------- 角色定义与技能（persona + skills，对标 Dify/Coze 人设与技能管理） ----------
  /** 角色与技能：角色写入配置中心 config_role，技能写 app_setting.skills（AgentToolBridge 读取） */
  @Get('persona')
  getPersona() {
    return this.settings.getPersona();
  }

  @Post('persona')
  savePersona(@Body() body: { name?: string; systemPrompt?: string; skills?: { id?: string; key: string; name: string; description: string; enabled?: number; builtin?: number }[] }) {
    return this.settings.savePersona(body);
  }
}
