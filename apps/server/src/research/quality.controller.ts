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

  @Get()
  history(@Query('documentId') documentId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(documentId, req.user);
    return this.quality.history(documentId);
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
