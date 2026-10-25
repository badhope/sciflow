import { HttpCode, Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Header, Req, BadRequestException, NotFoundException } from '@nestjs/common';
import { ReferencesService, PaperHit } from './references.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

@Controller('references')
export class ReferencesController {
  constructor(
    private readonly references: ReferencesService,
    private readonly access: ProjectAccessService,
  ) {}

  /** 文献库内检索（不自动入库；projectId 可选，用于限定当前项目） */
  @Post('search')
  search(@Body() body: { query?: string; limit?: number; projectId?: string }, @Req() req: { user?: AuthPayload }) {
    if (body?.projectId) this.access.assertProject(body.projectId, req.user);
    if (!body?.query?.trim()) return [];
    return this.references.search(body.query, body.limit || 8, body.projectId);
  }

  @Get()
  list(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    // 企业模式必须显式指定项目（与 documents 一致），避免一次请求拉走全库文献
    if (!projectId) {
      if (this.access.enforced) throw new BadRequestException('企业模式必须指定 projectId');
      return this.references.list(projectId);
    }
    this.access.assertProject(projectId, req.user);
    return this.references.list(projectId);
  }

  /** 系统综述·筛选队列列表（须声明在 :id 之前，避免 screen 被当成文献 id） */
  @Get('screen')
  screenList(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.references.screenList(projectId);
  }

  /** 系统综述·抽取字段列表 */
  @Get('extraction/fields')
  extractionFields(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.references.listExtractionFields(projectId);
  }

  /** 系统综述·抽取表矩阵 */
  @Get('extraction/table')
  extractionTable(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.references.extractionTable(projectId);
  }

  /** 引用网络图聚合（共引边 + 去重边），须声明在 :id 之前 */
  @Get('graph')
  graph(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.references.graph(projectId);
  }

  /** 导出项目全部文献为 BibTeX / RIS 纯文本（前端 fetch 后 Blob 下载） */
  @Get('export')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  exportRefs(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }, @Query('format') format?: string) {
    this.access.assertProject(projectId, req.user);
    return this.references.exportRefs(projectId, format || 'bibtex');
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertReference(id, req.user);
    return this.references.get(id);
  }

  /** 单条入库 */
  @Post()
  create(@Body() body: { projectId: string; hit: Partial<PaperHit> & { title: string } }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.references.create(body.projectId, body.hit);
  }

  /** 批量导入 */
  @Post('import')
  import(@Body() body: { projectId: string; hits: (Partial<PaperHit> & { title: string })[] }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.references.import(body.projectId, body.hits);
  }

  /** 导入 BibTeX 文本（指纹去重，返回 imported/skipped） */
  @Post('import-bibtex')
  importBibtex(@Body() body: { projectId: string; text: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.references.importBibtex(body.projectId, body.text || '');
  }

  /** 幂等引用写入：给某文档引用一篇文献；同 document+reference 已存在则返回既有记录 */
  @Post('citations')
  addCitation(@Body() body: { documentId: string; referenceId: string; location?: string; context?: string; format?: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(body.documentId, req.user);
    this.access.assertReference(body.referenceId, req.user);
    return this.references.addCitation(body);
  }

  /** 批量 DOI 本地格式核验（差距 #20）：合法者 readingStatus→cited；须声明在 :id 动态路由之前 */
  @Post('verify-dois')
  verifyDois(@Body() body: { ids: string[] }, @Req() req: { user?: AuthPayload }) {
    // 归属校验只拦截「存在但无权」的引用；不存在的 id 保持原契约进 skipped（不泄露存在性）
    for (const id of body.ids || []) {
      try {
        this.access.assertReference(id, req.user);
      } catch (e) {
        if (e instanceof NotFoundException) continue;
        throw e;
      }
    }
    return this.references.verifyDois(body.ids || []);
  }

  /** 更新阅读状态 / 标签 / 文献笔记 */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { readingStatus?: string; tags?: string; notes?: string | null }, @Req() req: { user?: AuthPayload }) {
    this.access.assertReference(id, req.user);
    return this.references.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertReference(id, req.user);
    return this.references.remove(id);
  }

  /** 系统综述·单条筛选（upsert） */
  @Post('screen')
  screen(@Body() body: { projectId: string; referenceId: string; status: string; reason?: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.references.screenUpsert(body.projectId, body.referenceId, body.status, body.reason || '');
  }

  /** 系统综述·批量筛选 */
  @Post('screen/bulk')
  screenBulk(@Body() body: { projectId: string; referenceIds: string[]; status: string; reason?: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.references.screenBulk(body.projectId, body.referenceIds || [], body.status, body.reason || '');
  }

  /** 系统综述·新建抽取字段 */
  @Post('extraction/fields')
  addExtractionField(
    @Body() body: { projectId: string; key: string; label: string; kind?: string; options?: string[] },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertProject(body.projectId, req.user);
    return this.references.addExtractionField(body.projectId, body.key, body.label, body.kind, body.options || []);
  }

  /** 系统综述·删除抽取字段（级联清理取值） */
  @Delete('extraction/fields/:id')
  removeExtractionField(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertExtractionField(id, req.user);
    return this.references.removeExtractionField(id);
  }

  /** 系统综述·设置某字段在某文献上的取值 */
  @Put('extraction/values')
  setExtractionValue(@Body() body: { fieldId: string; referenceId: string; value: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertExtractionField(body.fieldId, req.user);
    return this.references.setExtractionValue(body.fieldId, body.referenceId, body.value || '');
  }

  /** AI 综述（只基于文献库真实文献） */
  @Post('summarize')
  summarize(@Body() body: { projectId: string; topic: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.references.summarize(body.projectId, body.topic);
  }

  /** Elicit 式：结构化提取（方法/结果/贡献/局限对比表） */
  @Post('extract')
  extract(@Body() body: { projectId: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.references.extract(body.projectId);
  }

  /** Consensus 式：证据综合（论断 + 支持/矛盾 + 证据强度） */
  @Post('deep-dive')
  deepDive(@Body() body: { projectId: string; refId: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    this.access.assertReference(body.refId, req.user);
    return this.references.deepDive(body.projectId, body.refId);
  }

  @Post('gap')
  gap(@Body('projectId') projectId: string, @Body('topic') topic: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.references.gap(projectId, topic || '');
  }

  @Post('evidence')
  evidence(@Body() body: { projectId: string; question: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.references.evidence(body.projectId, body.question);
  }

  /** B-5.2 DOI 核验（opt-in 用户触发，Crossref 公共 API） */
  @Post(':id/verify-doi')
  @HttpCode(200)
  async verifyDoi(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertReference(id, req.user);
    return this.references.verifyDoi(id);
  }
}
