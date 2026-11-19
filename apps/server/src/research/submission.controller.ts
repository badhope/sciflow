import { Controller, Post, Get, Delete, Patch, Body, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SubmissionService } from './submission.service';
import { SubmissionReadinessService } from './submission-readiness.service';
import { JournalDto, SubmissionTrackDto } from './submission.dto';
import { SubmissionReadinessDto } from './submission-readiness.dto';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 投稿辅助 API（期刊库 / Cover Letter / 编辑邮件解析 / 投稿状态跟踪）。
 * v1.8 安全：此前零归属校验 —— 企业模式下可列他人项目的投稿记录与事件流
 * （期刊名、稿号、修回截止日）、改他人投稿状态、删他人投稿。期刊库是全局共享资源，
 * 增删仅管理员（实例级配置）。
 */
@ApiTags('Submission')
@Controller('submission')
export class SubmissionController {
  constructor(
    private readonly submission: SubmissionService,
    private readonly readiness: SubmissionReadinessService,
    private readonly access: ProjectAccessService,
  ) {}

  @Post('journals')
  recommend(@Body() body: { title?: string; abstract?: string; field?: string }) {
    return this.submission.recommendJournals(body.title || '', body.abstract || '', body.field || '');
  }

  /** 投稿就绪检查：文档 + 项目文献库 + citation 表 + 客观质量门，只读、不调模型 */
  @Get('readiness')
  @ApiOkResponse({ type: SubmissionReadinessDto })
  readinessCheck(
    @Query('projectId') projectId: string,
    @Query('documentId') documentId: string,
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertProject(projectId, req.user);
    this.access.assertDocument(documentId, req.user);
    return this.readiness.check(projectId, documentId);
  }

  /** 期刊库列表 */
  @Get('journals')
  @ApiOkResponse({ type: [JournalDto] })
  listJournals() {
    return this.submission.listJournals();
  }

  @Post('cover-letter')
  coverLetter(@Body() body: { title?: string; abstract?: string; journal: string }) {
    return this.submission.coverLetter(body.title || '', body.abstract || '', body.journal);
  }

  @Post('reply-review')
  replyReview(@Body() body: { reviewComments: string; response?: string; taskId?: string }) {
    return this.submission.replyReview(body.reviewComments, body.response || '', body.taskId);
  }

  /* —— 自建期刊库管理 —— */

  /** 新增期刊 */
  @Post('journals-lib')
  @ApiOkResponse({ type: JournalDto })
  addJournal(@Body() body: Record<string, any>, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    return this.submission.addJournal({
      name: body.name,
      issn: body.issn,
      publisher: body.publisher,
      scopeText: body.scopeText,
      if2024: body.if2024 ?? null,
      quartile: body.quartile,
      firstDecisionWeeks: body.firstDecisionWeeks ?? null,
      acceptanceRate: body.acceptanceRate ?? null,
      oa: body.oa,
    });
  }

  /** 删除期刊 */
  @Delete('journals-lib/:id')
  removeJournal(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    return this.submission.deleteJournal(id);
  }

  /** 结构化期刊匹配推荐 */
  @Post('journals-match')
  journalsMatch(@Body() body: { title?: string; abstract?: string }) {
    return this.submission.matchJournals(body.title || '', body.abstract || '');
  }

  /* —— 投稿流程状态跟踪 —— */

  /** 登记投稿（L1） */
  @Post('track')
  @ApiOkResponse({ type: SubmissionTrackDto })
  createTrack(@Body() body: Record<string, any>, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body?.projectId, req.user);
    if (body?.documentId) this.access.assertDocument(body.documentId, req.user);
    return this.submission.createTrack({
      projectId: body.projectId,
      journalId: body.journalId || '',
      journalName: body.journalName,
      documentId: body.documentId || '',
      title: body.title || '',
      submittedAt: body.submittedAt || undefined,
      currentStatus: body.currentStatus || 'submitted',
      note: body.note || '',
      previousSubmissionId: body.previousSubmissionId || '',
      revisionDeadline: typeof body.revisionDeadline === 'number' ? body.revisionDeadline : null,
    });
  }

  /** 投稿列表（含事件流 + 超期推断） */
  @Get('track')
  @ApiOkResponse({ type: [SubmissionTrackDto] })
  listTracks(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.submission.listTracks(projectId || '');
  }

  /** AI 解析编辑部邮件（只给建议，不改库） */
  @Post('track/parse-email')
  parseEmail(@Body() body: { emailText?: string; currentStatus?: string }) {
    return this.submission.parseTrackEmail({ emailText: body.emailText || '', currentStatus: body.currentStatus || '' });
  }

  /** 追加状态事件 */
  @Post('track/:id/event')
  @ApiOkResponse({ type: SubmissionTrackDto })
  addEvent(@Param('id') id: string, @Body() body: { status: string; date?: number; note?: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertSubmission(id, req.user);
    return this.submission.addTrackEvent(id, {
      status: body.status,
      date: body.date || undefined,
      note: body.note || '',
    });
  }

  /** 修改 note / currentStatus / revisionDeadline */
  @Patch('track/:id')
  @ApiOkResponse({ type: SubmissionTrackDto })
  updateTrack(@Param('id') id: string, @Body() body: { notes?: string; currentStatus?: string; revisionDeadline?: number | null }, @Req() req: { user?: AuthPayload }) {
    this.access.assertSubmission(id, req.user);
    return this.submission.updateTrack(id, { notes: body.notes, currentStatus: body.currentStatus, revisionDeadline: body.revisionDeadline });
  }

  /** 删除投稿（级联清事件） */
  @Delete('track/:id')
  removeTrack(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertSubmission(id, req.user);
    return this.submission.removeTrack(id);
  }
}
