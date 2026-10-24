import { Body, Controller, Get, Post, Patch, Delete, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ResearchService } from './research.service';

@Controller('research')
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

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
  async designExperiment(@Body() body: { projectId: string; question: string; papers?: any[] }) {
    return this.assertNoError(await this.research.designExperiment(body?.projectId || '', body?.question || '', body?.papers));
  }

  @Get('design')
  listDesigns(@Query('projectId') projectId: string) {
    return this.research.listDesigns(projectId || '');
  }

  @Delete('design/:id')
  deleteDesign(@Param('id') id: string) {
    return this.research.deleteDesign(id);
  }

  /* —— 审稿意见闭环 —— */

  /** 批量录入审稿意见 */
  @Post('review-comments')
  addReviewComments(@Body() body: { documentId: string; comments: { reviewer: string; commentText: string; category?: string }[] }) {
    return this.research.addReviewComments(body.documentId, body.comments || []);
  }

  /** 列出某文档的审稿意见 */
  @Get('review-comments')
  listReviewComments(@Query('documentId') documentId: string) {
    return this.research.listReviewComments(documentId);
  }

  /** 更新单条意见 */
  @Patch('review-comments/:id')
  updateReviewComment(@Param('id') id: string, @Body() body: { status?: string; responseText?: string; category?: string }) {
    return this.research.updateReviewComment(id, body);
  }

  /** 删除单条意见 */
  @Delete('review-comments/:id')
  deleteReviewComment(@Param('id') id: string) {
    return this.research.deleteReviewComment(id);
  }

  /** 生成 point-by-point 回复信 */
  @Post('response-letter')
  async responseLetter(@Body() body: { documentId: string }) {
    return this.research.generateResponseLetter(body.documentId);
  }
}
