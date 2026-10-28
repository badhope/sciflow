import { Controller, Get, Post, Body, Param, Query, Req } from '@nestjs/common';
import { QualityService } from './quality.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 质量评分 API。
 * v1.8 安全：此前零归属校验 —— 企业模式下可按 documentId 读他人稿件的评分与改进建议
 * （含正文摘要）、按 report id 读任意报告。现在统一经 document → project 断言。
 */
@Controller('quality')
export class QualityController {
  constructor(
    private readonly quality: QualityService,
    private readonly access: ProjectAccessService,
  ) {}

  @Post()
  review(@Body() body: { documentId: string; title: string; content: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(body?.documentId, req.user);
    return this.quality.review(body.documentId, body.title, body.content);
  }

  /**
   * 评分历史。
   * 本地模式允许不传 documentId（返回全部，历史契约：质量页首次进入与回归脚本依赖）；
   * 企业模式必须指定文档并断言归属。
   */
  @Get()
  history(@Query('documentId') documentId: string, @Req() req: { user?: AuthPayload }) {
    if (!documentId) {
      if (this.access.enforced) this.access.deny('企业模式必须指定 documentId');
      return this.quality.historyAll();
    }
    this.access.assertDocument(documentId, req.user);
    return this.quality.history(documentId);
  }

  /**
   * 项目内全部文档的最新分总览（v1.8）：客观分（当前正文，确定性）+ 最新 LLM 分。
   * 必须声明在 ':id' 动态路由之前，否则 'project-overview' 会被当成报告 id。
   */
  @Get('project-overview')
  projectOverview(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.quality.projectOverview(projectId);
  }

  /** 最新一次评分（须声明在 :id 之前，避免 latest 被当成报告 id）；无记录返回 null */
  @Get('latest')
  latest(@Query('documentId') documentId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(documentId, req.user);
    return this.quality.latest(documentId);
  }

  /** 差距 #7：把最新报告 feedback 结构化拆条写入 review_comment（幂等：同报告重复导出不新增） */
  @Post('export-comments')
  exportComments(@Query('documentId') documentId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(documentId, req.user);
    return this.quality.exportComments(documentId);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertQualityReport(id, req.user);
    return this.quality.get(id);
  }
}
