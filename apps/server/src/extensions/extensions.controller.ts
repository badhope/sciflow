import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors, Headers, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ExtensionsService, assetKey } from './extensions.service';
import { AdminGuard } from '../auth/admin.guard';

/**
 * 扩展中心 REST（v1.4）：skill / mcp / role / constraint / hook / prompt 统一资产。
 *
 * 四种添加方式共用本控制器：
 *  - 表单/模板手填 → POST /api/extensions
 *  - 粘贴 JSON / SKILL.md → POST /api/extensions/import（content 文本）
 *  - 拖拽文件 / ZIP → POST /api/extensions/upload（multipart，支持 .md/.json/.zip）
 *  - 一键 AI 生成 → POST /api/extensions/generate（返回草稿，确认后 POST /api/extensions）
 *  - 对话 → MCP 工具 extension.*（见 mcp.service）
 *
 * v1.8：整个控制器加 AdminGuard —— 启停内置资产会改约束/钩子/角色注入，
 * 属于实例级能力面，企业模式下仅 admin 可改。
 */
@Controller('extensions')
@UseGuards(AdminGuard)
export class ExtensionsController {
  constructor(private readonly extensions: ExtensionsService) {}

  @Get()
  list(@Query('kind') kind?: string) {
    return {
      kinds: this.extensions.kinds(),
      assets: this.extensions.list(kind),
      templates: this.extensions.templates(),
    };
  }

  @Get('templates')
  templates() {
    return this.extensions.templates();
  }

  @Post()
  create(@Body() body: {
    id?: string;
    kind: string;
    key?: string;
    name: string;
    description?: string;
    repo?: string;
    license?: string;
    install?: string;
    tags?: string[];
    manifest?: Record<string, unknown>;
    visibility?: string;
  }, @Headers() headers: Record<string, string | undefined>) {
    const actor = headers['x-sciflow-actor'] === 'cli' ? 'cli' : 'ui';
    return this.extensions.upsert({
      kind: body.kind as never,
      key: body.key || assetKey(String(body.kind), String(body.name || '')),
      name: body.name,
      description: body.description || '',
      manifest: body.manifest || {},
      repo: body.repo,
      license: body.license,
      install: body.install,
      tags: body.tags,
    }, { id: body.id, source: 'user', visibility: body.visibility, actor });
  }

  @Post(':id/toggle')
  toggle(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    return this.extensions.toggle(id, body?.enabled !== false);
  }

  @Post(':id/apply')
  apply(@Param('id') id: string) {
    return this.extensions.applyPrompt(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.extensions.remove(id);
  }

  @Post('reset-builtin')
  resetBuiltin() {
    return this.extensions.resetBuiltin();
  }

  /** 粘贴导入：content 为 SKILL.md 文本 / 模板 JSON / MCP JSON */
  @Post('import')
  importRaw(@Body() body: { filename?: string; content?: string }) {
    if (!body?.content?.trim()) throw new Error('导入内容为空');
    return this.extensions.importRaw({ filename: body.filename, content: body.content });
  }

  /** 拖拽上传：.md / .json / .zip（multipart/form-data，field=file） */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 32 * 1024 * 1024 } }))
  upload(@UploadedFile() file: { originalname?: string; buffer?: Buffer } | undefined) {
    if (!file?.buffer?.length) throw new Error('未收到文件内容（字段名需为 file）');
    return this.extensions.importRaw({ filename: file.originalname || '', content: new Uint8Array(file.buffer) });
  }

  /** 导出扩展包（不含私有优势工具） */
  @Get('export')
  exportBundle() {
    return this.extensions.exportBundle();
  }

  /** 一键 AI 生成（返回草稿，不落库） */
  @Post('generate')
  generate(@Body() body: { kind: string; brief: string }) {
    return this.extensions.generate(body?.kind, body?.brief || '');
  }
}
