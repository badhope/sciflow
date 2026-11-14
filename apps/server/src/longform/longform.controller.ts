import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { LongformService } from './longform.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 长篇写作 API（百万字级）：书 → 卷 → 章，逐章增量生成、可断点续写。
 *
 * 端点设计原则：
 *  - 写一章是独立请求（`write-next` / `write`），长任务由调用方循环，服务端不持有长连接；
 *  - 每章状态可查询，失败章节可重试，已完成章节永不被覆盖；
 *  - 合并导出走 `compile`，返回 markdown，不落 document（避免与稿件流水线混用）。
 */
@Controller('longform')
export class LongformController {
  constructor(
    private readonly longform: LongformService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('books')
  list(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.longform.listBooks(projectId);
  }

  @Post('books')
  create(
    @Body() body: { projectId: string; title: string; premise?: string; styleHint?: string; targetCharsPerChapter?: number },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertProject(body?.projectId, req.user);
    return this.longform.createBook(body);
  }

  @Get('books/:id')
  get(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertBook(id, req.user);
    return this.longform.getBook(id);
  }

  @Post('books/:id/volumes')
  addVolume(
    @Param('id') id: string,
    @Body() body: { title: string; goal?: string; chapters: number },
    @Req() req: { user?: AuthPayload },
  ) {
    this.assertBook(id, req.user);
    return this.longform.addVolume(id, body);
  }

  /** 写下一章（单章；前端轮询式推进） */
  @Post('books/:id/write-next')
  writeNext(@Param('id') id: string, @Body() body: { retryFailed?: boolean }, @Req() req: { user?: AuthPayload }) {
    this.assertBook(id, req.user);
    return this.longform.writeNextChapter(id, { retryFailed: body?.retryFailed === true });
  }

  /** 批量写 N 章（无人值守；失败即停并返回原因） */
  @Post('books/:id/write')
  write(@Param('id') id: string, @Body() body: { count?: number }, @Req() req: { user?: AuthPayload }) {
    this.assertBook(id, req.user);
    return this.longform.writeChapters(id, Number(body?.count) || 1);
  }

  /** 全书一致性检查（确定性规则，不调模型） */
  @Get('books/:id/consistency')
  consistency(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertBook(id, req.user);
    return this.longform.consistency(id);
  }

  @Get('books/:id/compile')
  compile(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertBook(id, req.user);
    return this.longform.compile(id);
  }

  /** 书籍存在性 + 归属校验（书籍挂在 project 下） */
  private assertBook(bookId: string, user?: AuthPayload) {
    const book = this.longform.getBook(bookId);
    this.access.assertProject(book.projectId, user);
    return book;
  }
}