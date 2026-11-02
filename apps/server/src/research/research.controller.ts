import { Body, Controller, Get, Post, Patch, Delete, Param, Query, HttpException, HttpStatus, Req } from '@nestjs/common';
import { ResearchService } from './research.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 科研辅助 API（设计诊断 / 文献对比 / 模拟评审 / 实验设计稿 / 审稿意见闭环）。
 * v1.8 安全：此前零归属校验 —— 企业模式下可列他人项目的设计稿、读写他人文档的审稿意见、
 * 用他人正文生成回复信。现在所有落库/读取类端点断言归属。
 */
@Controller('research')
export class ResearchController {
  constructor(
    private readonly research: ResearchService,
    private readonly access: ProjectAccessService,
  ) {}

  /** 统一处理 AI 返回的 { error } 结构：有 error 时抛 HttpException；过滤可能含 internal 信息的字段后返回结果 */
  private assertNoError(result: any) {
    if (result && typeof result === 'object' && 'error' in result && typeof result.error === 'string') {
      throw new HttpException(result.error, HttpStatus.BAD_REQUEST);
    }
    return result;
  }

  @Post('design-review')
  async designReview(@Body() body: { idea: string; papers?: any[] }) {
    return this.assertNoError(await this.research.designReview(body?.idea || '', body?.papers));
  }

  @Post('comparison')
  async compare(@Body() body: { papers: any[] }) {
    return this.assertNoError(await this.research.comparePapers(body?.papers || []));
  }

  @Post('review')
  async review(@Body() body: { title: string; content: string }) {
    return this.assertNoError(await this.research.simulatedReview(body?.title || '', body?.content || ''));
  }

  /* —— F3 实验设计助手 —— */

  /** 研究问题 → 结构化实验设计稿（落库，可在实验页复看） */
  @Post('design')
  async designExperiment(@Body() body: { projectId: string; question: string; papers?: any[] }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body?.projectId, req.user);
    return this.assertNoError(await this.research.designExperiment(body?.projectId || '', body?.question || '', body?.papers));
  }

  @Get('design')
  listDesigns(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.research.listDesigns(projectId || '');
  }

  @Delete('design/:id')
  deleteDesign(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchDesign(id, req.user);
    return this.research.deleteDesign(id);
  }

  /* —— 审稿意见闭环 —— */

  /** 批量录入审稿意见 */
  @Post('review-comments')
  addReviewComments(@Body() body: { documentId: string; comments: { reviewer: string; commentText: string; category?: string }[] }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(body?.documentId, req.user);
    return this.research.addReviewComments(body.documentId, body.comments || []);
  }

  /** 列出某文档的审稿意见 */
  @Get('review-comments')
  listReviewComments(@Query('documentId') documentId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(documentId, req.user);
    return this.research.listReviewComments(documentId);
  }

  /** 更新单条意见 */
  @Patch('review-comments/:id')
  updateReviewComment(@Param('id') id: string, @Body() body: { status?: string; responseText?: string; category?: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertReviewComment(id, req.user);
    return this.research.updateReviewComment(id, body);
  }

  /** 删除单条意见 */
  @Delete('review-comments/:id')
  deleteReviewComment(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertReviewComment(id, req.user);
    return this.research.deleteReviewComment(id);
  }

  /** 生成 point-by-point 回复信 */
  @Post('response-letter')
  async responseLetter(@Body() body: { documentId: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(body?.documentId, req.user);
    return this.research.generateResponseLetter(body.documentId);
  }
}
