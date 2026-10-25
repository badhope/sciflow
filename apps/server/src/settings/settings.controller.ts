import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

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
  saveProvider(@Body() body: { id?: string; name: string; baseUrl: string; apiKey?: string; model: string }) {
    return this.settings.saveProvider(body);
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
  @Get('persona')
  getPersona() {
    return this.settings.getPersona();
  }

  @Post('persona')
  savePersona(@Body() body: { name?: string; systemPrompt?: string; skills?: { id?: string; key: string; name: string; description: string; enabled?: number; builtin?: number }[] }) {
    return this.settings.savePersona(body);
  }
}
