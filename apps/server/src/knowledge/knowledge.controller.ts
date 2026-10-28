import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 知识库 API。
 * v1.8 安全：此前本控制器**零归属校验**——企业模式下任一账号可用他人的 projectId 上传资料、
 * 读取全部资料原文（GET /:id）、跨项目 RAG 问答（等于让别人的私有资料进自己的 prompt）。
 * 现在所有读写都按 projectId / docId 断言归属。
 */
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly access: ProjectAccessService,
  ) {}

  /** 上传资料（text | pdf | markdown；PDF 传 base64） */
  @Post('upload')
  upload(@Body() body: { projectId: string; name: string; type: string; content: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.knowledge.upload(body.projectId, body.name, body.type || 'text', body.content);
  }

  /**
   * 知识库列表。
   * 本地模式（AUTH_MODE!=jwt）允许不传 projectId 返回全部 —— 历史行为，回归与 CLI 依赖；
   * 企业模式必须显式指定并断言归属（避免一次拉走全库资料）。
   */
  @Get()
  list(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    if (!projectId) {
      if (this.access.enforced) this.access.deny('企业模式必须指定 projectId');
      return this.knowledge.listAll();
    }
    this.access.assertProject(projectId, req.user);
    return this.knowledge.list(projectId);
  }

  /**
   * 知识库语义地图（F-2.2）：分块 embedding 的 2D 投影。
   * 只读已有向量，不调用嵌入模型；超过 limit 自动下采样。
   */
  @Get(':id/map')
  map(@Param('id') projectId: string, @Req() req: { user?: AuthPayload }, @Query('limit') limit?: string) {
    this.access.assertProject(projectId, req.user);
    return this.knowledge.semanticMap(projectId, limit ? Math.max(1, Math.min(20000, Number(limit) || 5000)) : 5000);
  }

  /** RAG 问答 */
  @Post('query')
  query(@Body() body: { projectId: string; question: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body?.projectId, req.user);
    return this.knowledge.query(body.projectId, body.question);
  }

  /** 纯检索（不调 LLM，BM25+向量混合，本地零依赖）：body {projectId, query}，返回命中文块（与 query 的 sources 同源） */
  @Post('search')
  search(@Body() body: { projectId: string; query?: string; question?: string }, @Req() req: { user?: AuthPayload }) {
    /**
     * 归属校验只拦「存在的他人项目」（企业模式）；不存在的 projectId 保持历史契约返回空数组，
     * 不抛 404 —— 纯检索是只读探测，抛错会让调用方（如全局搜索）整体失败。
     */
    if (this.access.enforced) this.access.assertProject(body?.projectId, req.user);
    return this.knowledge.search(body.projectId, body.query || body.question || '', 5);
  }

  /** 单文档取数：全部分块正文（按 seq 升序）+ outline（Markdown 标题派生）。
   *  注意：声明在无参 list 之后、':id' 参数路由之前，避免字面量被 :id 吞掉。 */
  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertKnowledgeDoc(id, req.user);
    return this.knowledge.get(id);
  }

  /** 文献库↔知识库打通（#5）：手动绑定/解除文献，入参 {referenceId | null} */
  @Patch(':id/bind')
  bind(@Param('id') id: string, @Body() body: { referenceId: string | null }, @Req() req: { user?: AuthPayload }) {
    this.access.assertKnowledgeDoc(id, req.user);
    // referenceId 不存在时由 service 报 400（历史契约）；企业模式先拦「存在的他人文献」
    if (body?.referenceId && this.access.enforced) this.access.assertReference(body.referenceId, req.user);
    return this.knowledge.bind(id, body.referenceId ?? null);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertKnowledgeDoc(id, req.user);
    return this.knowledge.remove(id);
  }
}
