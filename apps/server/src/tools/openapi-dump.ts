/**
 * OpenAPI 导出工具（编译产物：dist/tools/openapi-dump.js）
 * 用途：`pnpm openapi:gen` 生成 openapi.json → openapi-typescript → 前端类型化客户端。
 * 不监听端口；仅创建 Nest 上下文，导出 JSON 后退出（DATABASE_PATH 建议指向临时库）。
 */
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { AppModule } from '../app.module';
import { APP_VERSION } from '../common/version';

(async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('SciFlow API').setDescription('本地优先科研工作台（单用户）').setVersion(APP_VERSION).build(),
  );
  const out = process.argv[2] || 'openapi.json';
  writeFileSync(out, JSON.stringify(doc, null, 2));
  console.log(`[openapi] 已导出 ${out}（paths=${Object.keys(doc.paths || {}).length}）`);
  await app.close();
  process.exit(0);
})();
