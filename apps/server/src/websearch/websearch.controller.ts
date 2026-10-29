/**
 * Web 搜索 API
 *  - POST /api/web/search?q=...       执行搜索（按当前 provider 分发，带缓存+降级）
 *  - GET  /api/web/config             当前 provider 配置（key 掩码回显）
 *  - PUT  /api/web/config             保存 provider 配置（开源 SearXNG 填 URL；商业引擎用户自填 Key）
 *
 * v1.8：加 AdminGuard —— provider Key 是实例级密钥，企业模式下 member 不应能读写。
 */

import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { WebSearchService } from './websearch.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('web')
@UseGuards(JwtAuthGuard, AdminGuard)
export class WebSearchController {
  constructor(private readonly ws: WebSearchService) {}

  /**
   * 执行搜索（v1.9.2 反静默降级）：结果为空时必须带 notice 说明原因——
   * 此前所有 provider 失败都静默返回 []（HTTP 201），用户无从区分
   * 「真的没有结果」与「provider 在当前网络不可达」。
   */
  @Post('search')
  async search(@Body() body: { q?: string }) {
    const q = body?.q?.trim() || '';
    if (!q) return { error: 'q required', results: [] };
    const { results, provider, notice } = await this.ws.searchWithDiagnostics(q);
    return { results, context: WebSearchService.toContext(results), provider, notice };
  }

  @Get('config')
  config() {
    return this.ws.getConfigMasked();
  }

  @Put('config')
  saveConfig(
    @Body()
    body: Partial<{ provider: string; searxngUrl: string; tavilyKey: string; serperKey: string; braveKey: string }>,
  ) {
    try {
      return this.ws.saveConfig(body ?? {});
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
}
