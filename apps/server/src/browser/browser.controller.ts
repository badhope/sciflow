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

  @Post('sessions/:id/click')
  click(@Param('id') id: string, @Body() body: { selector: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    if (!body?.selector?.trim()) throw new BadRequestException('selector 必填');
    return this.browser.click(id, body.selector);
  }

  @Post('sessions/:id/fill')
  fill(@Param('id') id: string, @Body() body: { selector: string; value: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertAdmin(req.user);
    if (!body?.selector?.trim()) throw new BadRequestException('selector 必填');
    return this.browser.fill(id, body.selector, String(body.value ?? ''));
  }
}
