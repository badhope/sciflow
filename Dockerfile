# ============ 构建阶段：全量安装 + 双端编译 ============
# 基础镜像用 glibc 的 slim 而非 alpine(musl)：better-sqlite3 / node-llama-cpp / sqlite-vec
# 都依赖 glibc 预编译二进制；musl 下 better-sqlite3 无预编译包且容器内缺少编译工具链，
# 实测 pnpm install 直接失败（gyp ERR: not ok）。slim 下走预编译，无需长编译。
FROM node:22-slim AS build
# 版本与仓库 packageManager 保持一致（此前写 pnpm@9，与 lockfile 混用会产生解析歧义）
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
# 原生模块兜底编译工具链（预编译不可用时回退源码编译）
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ poppler-utils ffmpeg tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
# 桌面端（Electron）不参与容器构建：跳过其二进制下载，避免无谓的 ~100MB 拉取
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# workspace 声明为 apps/*，锁文件含 desktop importer；补其 package.json 以保证 frozen 校验一致，
# 再按 filter 只装 web/server（不装 electron 依赖树）
COPY apps/desktop/package.json apps/desktop/
RUN pnpm install --frozen-lockfile --filter @sciflow/server --filter @sciflow/web
COPY apps/server apps/server
COPY apps/web apps/web
# packages/ 是 server 与 web 共用的能力层（core/db/ai/retrieval），
# 两边都以相对路径或 @sciflow/core 别名引用，缺它会在 tsc 阶段报 TS2307
COPY packages packages
RUN pnpm --filter @sciflow/server build && pnpm --filter @sciflow/web build

# ============ 后端运行时 ============
# 与构建阶段同为 glibc（原生模块二进制按 glibc 编译/下载，不可跨 libc 混用）
FROM node:22-slim AS server
WORKDIR /app
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/node_modules ./node_modules
WORKDIR /app/apps/server
EXPOSE 3000
# AI 配置经环境变量注入（AI_BASE_URL / AI_API_KEY / AI_MODEL），勿把 .env 打进镜像
CMD ["node", "dist/apps/server/src/main.js"]

# ============ 前端运行时（nginx 静态 + /api 反代） ============
FROM nginx:alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
