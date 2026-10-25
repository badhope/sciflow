import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  list(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    // 历史行为：不传 projectId 返回全部（本地/桌面单用户，用于全局搜索等）。
    // 企业模式必须显式指定项目，否则拒绝——避免一次请求拉走全库文档。
    if (!projectId) {
      if (this.access.enforced) throw new BadRequestException('企业模式必须指定 projectId');
      return this.documents.listAll();
    }
    this.access.assertProject(projectId, req.user);
    return this.documents.list(projectId);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    // 归属校验（企业模式防 IDOR；本地模式 no-op）——此前可直接按 id 读他人项目文档
    this.access.assertDocument(id, req.user);
    return this.documents.get(id);
  }

  /** B-4.3 引用体检：锚点×落库交叉审计（幽灵引用/无 DOI 黄牌/绿牌） */
  @Get(':id/citation-audit')
  citationAudit(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.citationAudit(id);
  }

  @Post()
  create(@Body() body: { projectId?: string; title?: string }, @Req() req: { user?: AuthPayload }) {
    if (!body?.projectId?.trim()) throw new BadRequestException('projectId 必填');
    if (!body?.title?.trim()) throw new BadRequestException('文档标题必填');
    this.access.assertProject(body.projectId, req.user);
    return this.documents.create(body.projectId, { title: body.title });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { title?: string; content?: string; outline?: string; status?: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.update(id, body);
  }

  /** 缺口#2：为某个历史版本命名（versions JSON 内嵌 name，幂等覆盖；version 不存在返回 400） */
  @Patch(':id/version-name')
  setVersionName(@Param('id') id: string, @Body() body: { version: number; name: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.setVersionName(id, Number(body.version), body.name);
  }

  /** 为某个历史版本写入/覆盖 commit message（对标 git commit message；version 不存在返回 400） */
  @Patch(':id/versions/:version/commit-message')
  setVersionCommitMessage(@Param('id') id: string, @Param('version') version: number, @Body() body: { message: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.setVersionCommitMessage(id, Number(version), body.message || '');
  }

  /** 创建手动版本快照（对标 git commit）：显式点保存当前内容快照 + commit message（幂等） */
  @Post(':id/snapshot')
  @HttpCode(HttpStatus.OK)
  createSnapshot(@Param('id') id: string, @Body() body: { commitMessage?: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return { versions: this.documents.createSnapshot(id, body.commitMessage) };
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.remove(id);
  }

  // --- AI 写作工具 ---
  @Post(':id/outline')
  generateOutline(@Param('id') id: string, @Body() body: { topic?: string; summary?: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.generateOutline(id, body.topic || '', body.summary || '');
  }

  @Post(':id/section')
  draftSection(@Param('id') id: string, @Body() body: { sectionTitle: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.draftSection(id, body.sectionTitle);
  }

  @Post(':id/abstract')
  generateAbstract(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.generateAbstract(id);
  }

  @Post(':id/polish')
  polish(@Param('id') id: string, @Body() body: { text: string; mode?: 'polish' | 'reduce' }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.polish(id, body.text, body.mode || 'polish');
  }

  @Post(':id/translate')
  translate(@Param('id') id: string, @Body() body: { text: string; targetLang?: 'zh' | 'en' }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.translate(id, body.text, body.targetLang || 'zh');
  }

  @Get(':id/polish-records')
  listPolishRecords(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.listPolishRecords(id);
  }

  // --- 引用管理 ---
  @Post(':id/citations')
  addCitation(@Param('id') id: string, @Body() body: { referenceId: string; location?: string; context?: string; format?: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.addCitation(id, body);
  }

  @Get(':id/citations')
  listCitations(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.listCitations(id);
  }

  @Delete(':id/citations/:citationId')
  removeCitation(@Param('id') _id: string, @Param('citationId') citationId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(_id, req.user);
    return this.documents.removeCitation(citationId);
  }

  @Get(':id/export-citations')
  exportCitations(@Param('id') id: string, @Query('format') format: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.exportCitations(id, format || 'apa');
  }

  /** 缺口#4：按 8 样式渲染正文锚点+参考文献列表（纯函数预览，永不落库；前端确认后自行 PATCH content 覆盖） */
  @Post(':id/render-citations')
  renderCitations(@Param('id') id: string, @Body() body: { style: string; dryRun?: boolean }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.renderCitations(id, body.style, body.dryRun);
  }

  /** 导出 Markdown 全文 */
  @Get(':id/export')
  exportMarkdown(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.exportMarkdown(id);
  }

  /** 导出 Word(.docx) 全文（交稿/投稿） */
  @Get(':id/export-docx')
  async exportDocx(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(id, req.user);
    return this.documents.exportDocx(id);
  }
}
