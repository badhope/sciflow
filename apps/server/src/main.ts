import 'dotenv/config';
import { loadServerEnv } from './common/server-env';

loadServerEnv();
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { InputValidationPipe } from './common/input-validation.pipe';
import { envInt } from './common/env';
import { APP_VERSION } from './common/version';

async function bootstrap() {
  // ---------- 启动期安全闸：非回环绑定必须启用鉴权，否则拒绝启动 ----------
  // 零鉴权 API 会暴露全部语料与 /api/experiments 类执行面；容器里 HOST=0.0.0.0 是常态，
  // 因此把「暴露 = 必须 AUTH_MODE=jwt」做成硬约束，确需内网裸跑时显式 ALLOW_INSECURE_BIND=1。
  const bindHost = process.env.HOST || '127.0.0.1';
  const isLoopback = bindHost === '127.0.0.1' || bindHost === 'localhost' || bindHost === '::1';
  if (!isLoopback && (process.env.AUTH_MODE || 'none') !== 'jwt' && process.env.ALLOW_INSECURE_BIND !== '1') {
    console.error(
      `[SciFlow] 拒绝启动：HOST=${bindHost} 非回环地址，但 AUTH_MODE 未设为 jwt。` +
      `零鉴权模式下所有科研数据与执行接口都对网络开放。请设置 AUTH_MODE=jwt + JWT_SECRET，` +
      `或明确承担风险时设置 ALLOW_INSECURE_BIND=1。`,
    );
    process.exit(1);
  }

  // ---------- 全局兜底：异步任务（流水线 fire-and-forget）漏网异常不再崩进程 ----------
  process.on('unhandledRejection', (reason) => {
    console.error(`[SciFlow] unhandledRejection 已兜底: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
  });
  process.on('uncaughtException', (err) => {
    console.error(`[SciFlow] uncaughtException 已兜底: ${err.stack || err.message}`);
  });

  // ---------- 优雅关闭：SIGTERM/SIGINT 时安全落盘（WAL check point）+ 退出 ----------
  let appRef: { close(): Promise<any> } | null = null;
  const shutdown = async (signal: string) => {
    console.log(`[SciFlow] 收到 ${signal}，正在优雅关闭…`);
    try {
      if (appRef) await appRef.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  appRef = app;
  app.useLogger(app.get(Logger));
  // 请求体上限：知识库上传 PDF 走 base64 JSON，Express 默认 100kb 会在 ~75KB 的 PDF 上就 500。
  // 与 nginx.conf 的 client_max_body_size 64m 对齐；超限抛 413（HttpExceptionFilter 已映射为可读中文）。
  const bodyLimit = process.env.BODY_LIMIT || '64mb';
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });
  // HTTP 安全头（helmet 默认集：CSP 关闭以兼容本地静态资源；其余 X-Content-Type-Options/HSTS/Referrer-Policy 等生效）
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  // CORS：默认仅放行本地开发来源，可通过 CORS_ORIGIN 配置（如逗号分隔多个域名；* 表示全放行）
  const corsOrigin = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigin.length === 1 && corsOrigin[0] === '*' ? true : corsOrigin,
    credentials: true,
  });
  app.setGlobalPrefix('api');
  // OpenAPI 契约：本地文档端点（/api/docs）+ 供 openapi-typescript 生成前端类型（pnpm openapi:gen）
  const openapiDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('SciFlow API')
      .setDescription('本地优先科研工作台（单用户）')
      // 版本走 APP_VERSION 单一来源（历史：此处写死 0.8.1，包版本升到 1.x 后 OpenAPI 仍自报 0.8.1）
      .setVersion(APP_VERSION)
      .build(),
  );
  SwaggerModule.setup('api/docs', app, openapiDoc);
  // 全局输入校验（轻量兜底，零新增依赖）：仅约束 @Body() 为 JSON 对象，不剥字段、不误伤现有端点
  app.useGlobalPipes(new InputValidationPipe());
  const port = envInt('PORT', 3000, { min: 1, max: 65535 });
  // 安全基线：单用户本地定位服务，只回环监听 127.0.0.1，不再对局域网暴露零鉴权 API。
  // 确需对外暴露时显式设置 HOST=0.0.0.0（默认安全，opt-in 暴露）。
  const host = process.env.HOST || '127.0.0.1';
  await app.listen(port, host);
  console.log(`[SciFlow] API 已启动: http://localhost:${port}/api/health （仅监听 ${host}）`);

  // ---------- 断点续跑：重启后恢复 status=running 的流水线任务（DAG 事务落盘回放） ----------
  try {
    const { PipelineService } = await import('./pipeline/pipeline.service');
    const pipeline = app.get(PipelineService);
    const resumed = pipeline.resumeInterrupted();
    if (resumed > 0) console.log(`[SciFlow] checkpoint 恢复完成：${resumed} 个中断任务已处理`);
  } catch (e: any) {
    console.warn(`[SciFlow] checkpoint 恢复失败（不影响启动）: ${e.message}`);
  }
}

bootstrap();
