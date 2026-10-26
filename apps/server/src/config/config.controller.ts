import { Body, Controller, Delete, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ConfigCenterService } from './config-center.service';

/**
 * 配置中心 REST（Web 设置页 / CLI / 对话工具共用同一服务）。
 * 所有写操作内部走权限矩阵 + 审计；核心保护项不经此控制器暴露。
 */
@Controller('config')
export class ConfigController {
  constructor(private readonly config: ConfigCenterService) {}

  /** 审计区分来源：Web=ui（默认）/ CLI=cli（请求头）/ 对话工具=chat（服务内写死） */
  private actor(headers: Record<string, string | undefined>): string {
    const a = String(headers['x-sciflow-actor'] || '').trim().toLowerCase();
    return a === 'cli' || a === 'ui' || a === 'chat' ? a : 'ui';
  }

  @Get()
  snapshot() {
    return this.config.snapshot();
  }

  @Get('permission')
  getPermission() {
    return this.config.getPermissionInfo();
  }

  @Post('permission')
  setPermission(@Body() body: { mode: string }, @Headers() headers: Record<string, string | undefined>) {
    return this.config.setPermissionMode(body?.mode, this.actor(headers));
  }

  @Get('roles')
  listRoles() {
    return this.config.listRoles();
  }

  @Post('roles')
  createRole(@Body() body: { name: string; systemPrompt?: string; isDefault?: boolean }, @Headers() headers: Record<string, string | undefined>) {
    return this.config.createRole(body, this.actor(headers));
  }

  @Post('roles/:id')
  updateRole(@Param('id') id: string, @Body() body: { name?: string; systemPrompt?: string; isDefault?: boolean; enabled?: number }, @Headers() headers: Record<string, string | undefined>) {
    return this.config.updateRole(id, body, this.actor(headers));
  }

  @Delete('roles/:id')
  deleteRole(@Param('id') id: string, @Headers() headers: Record<string, string | undefined>) {
    return this.config.deleteRole(id, this.actor(headers));
  }

  @Get('constraints')
  listConstraints() {
    return this.config.listConstraints();
  }

  @Post('constraints')
  createConstraint(@Body() body: { title: string; rule: string; level?: string; scope?: string; sortOrder?: number }, @Headers() headers: Record<string, string | undefined>) {
    return this.config.createConstraint(body, this.actor(headers));
  }

  @Post('constraints/:id')
  updateConstraint(@Param('id') id: string, @Body() body: { title?: string; rule?: string; level?: string; scope?: string; enabled?: number; sortOrder?: number }, @Headers() headers: Record<string, string | undefined>) {
    return this.config.updateConstraint(id, body, this.actor(headers));
  }

  @Delete('constraints/:id')
  deleteConstraint(@Param('id') id: string, @Headers() headers: Record<string, string | undefined>) {
    return this.config.deleteConstraint(id, this.actor(headers));
  }

  @Get('hooks')
  listHooks() {
    return this.config.listHooks();
  }

  @Post('hooks')
  createHook(@Body() body: { name: string; event: string; type: string; config?: unknown; priority?: number }, @Headers() headers: Record<string, string | undefined>) {
    return this.config.createHook(body, this.actor(headers));
  }

  @Post('hooks/:id')
  updateHook(@Param('id') id: string, @Body() body: { name?: string; event?: string; type?: string; config?: unknown; enabled?: number; priority?: number }, @Headers() headers: Record<string, string | undefined>) {
    return this.config.updateHook(id, body, this.actor(headers));
  }

  @Delete('hooks/:id')
  deleteHook(@Param('id') id: string, @Headers() headers: Record<string, string | undefined>) {
    return this.config.deleteHook(id, this.actor(headers));
  }

  @Get('presets')
  listPresets() {
    return this.config.listPresets();
  }

  @Post('presets/:id/apply')
  applyPreset(@Param('id') id: string, @Headers() headers: Record<string, string | undefined>) {
    return this.config.applyPreset(id, this.actor(headers));
  }

  /** 导出配置包（备份 / 分享） */
  @Get('export')
  exportBundle() {
    return this.config.exportBundle();
  }

  /** 导入配置包（外部来源或备份恢复）：merge 默认 true 追加 */
  @Post('import')
  importBundle(@Body() body: { bundle?: unknown; merge?: boolean; applyPermission?: boolean }, @Headers() headers: Record<string, string | undefined>) {
    return this.config.importBundle(body?.bundle ?? body, { merge: body?.merge !== false, applyPermission: body?.applyPermission === true }, this.actor(headers));
  }

  @Get('preview')
  preview(@Query('scope') scope: string) {
    return this.config.preview(scope === 'pipeline' ? 'pipeline' : 'chat');
  }

  @Get('audit')
  audit(@Query('limit') limit: string) {
    return this.config.listAudit(Number(limit) || 100);
  }
}
