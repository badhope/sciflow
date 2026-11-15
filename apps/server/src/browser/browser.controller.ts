import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { BrowserService } from './browser.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 内置浏览器 API。
 *
 * 会话是**实例级**资源（不属于某个项目），但企业模式下仍要求登录；
 * 读页面内容可能触及任意站点，因此按 admin 级收紧（本地模式无门槛）。
 */
@Controller('browser')
export class BrowserController {
  constructor(
    private readonly browser: BrowserService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('sessions')
  async list(@Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    return this.browser.list();
  }

  @Post('sessions')
  async open(@Body() body: { url: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    if (!body?.url?.trim()) throw new BadRequestException('url 必填');
    return this.browser.open(body.url.trim());
  }

  @Delete('sessions/:id')
  async close(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    return this.browser.close(id);
  }

  @Post('sessions/:id/navigate')
  navigate(@Param('id') id: string, @Body() body: { url: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    if (!body?.url?.trim()) throw new BadRequestException('url 必填');
    return this.browser.navigate(id, body.url.trim());
  }

  @Get('sessions/:id/text')
  text(@Param('id') id: string, @Query('maxChars') maxChars: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    return this.browser.text(id, Number(maxChars) || 8000);
  }

  @Get('sessions/:id/screenshot')
  screenshot(@Param('id') id: string, @Query('fullPage') fullPage: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    return this.browser.screenshot(id, fullPage === '1');
  }

  @Get('sessions/:id/elements')
  elements(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    return this.browser.elements(id);
  }

  /** 网页验收：按断言列表检查页面并给出通过/失败 */
  @Post('sessions/:id/verify')
  verify(
    @Param('id') id: string,
    @Body()
    body: {
      checks?: {
        type: 'exists' | 'text' | 'count' | 'visible' | 'value' | 'request' | 'no-console-error' | 'visual';
        selector?: string;
        expect?: string | number;
        label?: string;
        urlIncludes?: string;
        /** visual 断言：基线名称 */
        baseline?: string;
        /** visual 断言：允许的差异比例 */
        maxDiffRatio?: number;
      }[];
    },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertAdmin(req.user);
    if (!Array.isArray(body?.checks) || body.checks.length === 0) throw new BadRequestException('checks 不能为空');
    if (body.checks.length > 50) throw new BadRequestException('单次最多 50 条断言');
    return this.browser.verify(id, body.checks);
  }

  @Post('sessions/:id/click')
  click(@Param('id') id: string, @Body() body: { selector: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    if (!body?.selector?.trim()) throw new BadRequestException('selector 必填');
    return this.browser.click(id, body.selector);
  }

  /** 视觉基线列表（按保存时间倒序） */
  @Get('baselines')
  baselines(@Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    return this.browser.listBaselines();
  }

  /** 把当前页面存为视觉基线（同名覆盖 = 接受这次外观） */
  @Post('sessions/:id/baseline')
  saveBaseline(
    @Param('id') id: string,
    @Body() body: { name?: string; fullPage?: boolean },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertAdmin(req.user);
    const name = String(body?.name || '').trim();
    if (!name) throw new BadRequestException('基线名称必填');
    return this.browser.saveBaseline(id, name, body?.fullPage === true);
  }

  /** 视觉回归：当前截图与基线逐像素比对，返回差异比例与差异图 */
  @Post('sessions/:id/visual-diff')
  visualDiff(
    @Param('id') id: string,
    @Body() body: { name?: string; fullPage?: boolean; maxDiffRatio?: number; pixelThreshold?: number },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertAdmin(req.user);
    const name = String(body?.name || '').trim();
    if (!name) throw new BadRequestException('基线名称必填');
    return this.browser.compareBaseline(id, name, {
      fullPage: body?.fullPage === true,
      maxDiffRatio: body?.maxDiffRatio,
      pixelThreshold: body?.pixelThreshold,
    });
  }

  @Delete('baselines/:name')
  deleteBaseline(@Param('name') name: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    return this.browser.deleteBaseline(name);
  }

  @Post('sessions/:id/fill')
  fill(@Param('id') id: string, @Body() body: { selector: string; value: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    if (!body?.selector?.trim()) throw new BadRequestException('selector 必填');
    return this.browser.fill(id, body.selector, String(body.value ?? ''));
  }
}
