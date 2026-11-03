# 桌面端（Electron）说明与故障排查

## 1. 原理

Electron 主进程启动内嵌 NestJS 后端（随机回环端口），然后用**自定义协议** `app://sciflow/index.html`
加载前端静态资源（`resources/web`），页面通过 preload 注入的 `window.sciflowDesktop.apiBase`
访问后端。

## 1.1 原生模块与安装包（2026-11 更新）

- **better-sqlite3 ABI**：`prepare-server.mjs` 按 Electron 版本用 node-abi 精确换算 ABI，三级获取：
  ① GitHub 官方预编译包 → ② npmmirror 二进制镜像直链（`--download`）→ ③ node-gyp 源码重编（需 VS C++）。
  前两级免工具链。镜像可能滞后新 Electron 的 ABI（如 v149），此时优先 ①/③ 或降级 Electron 小版本。
- **Electron 版本**：当前钉 `42.11.18`（ABI 146）。安全底线 ≥ 41.10.7（5 条 high 修复线）；
  升级到 44+ 前先确认 better-sqlite3 已发布对应 ABI 的预编译包，或 CI runner 可重编。
- **Windows 安装包 CI**：打 tag `v*` 触发 `.github/workflows/desktop-installer.yml`，
  在 GitHub runner 出 NSIS 安装包并附到 Release；`workflow_dispatch` 手动触发可下 artifact。
- **构建环境变量**（本机与 CI 均建议显式设置）：`CI=true`（electron-builder 的
  pnpm collector 会在工作区跑 production install，无 TTY 会交互卡死）、
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`、
  `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
  （NSIS/7zip 等构建工具链走镜像，GitHub 直连被墙/抖动时必备）。
  **构建会把工作区 dev 依赖剪掉**（electron-builder 的 pnpm collector 行为），
  构建完成后必须重跑 `pnpm install --frozen-lockfile` 恢复开发树。
- **pnpm 交互确认**：electron-builder 会在 bundle 内跑 `pnpm install --production`，
  无 TTY 时必须 `CI=true`（或 `confirmModulesPurge=false`），否则打包中断。
- **产物位置**：`apps/desktop/release/SciFlow-Setup-<version>-x64.exe`（dist 输出目录即 release/）。

## 2. 为什么不用 `file://`（重要，勿回退）

这是 0.7.0 / 0.8.0 早期版本「**打开软件什么都没有（白屏）**」的根因，两层原因叠加：

1. **绝对路径**：web 用默认 `base: '/'` 构建，`index.html` 里是 `/assets/index-xxx.js`。
   `file://` 加载时被解析成 `file:///C:/assets/...` → 全部 404。
2. **ES module + 空 origin**：即使改成相对路径，`file://` 页面的 origin 是 `null`，
   Chromium 会按 CORS 拒绝加载 `<script type="module">`：
   `Access to script at 'file:///...' from origin 'null' has been blocked by CORS policy`。

因此：
- 桌面端构建必须 `vite build --base=./`（`apps/desktop` 的 `build:web` 脚本已固化）
- 页面必须通过 `app://`（`standard: true` + `secure: true`）加载
- `prepare-server.mjs` 的 `assertWebRelative()` 会在打包前拦截绝对路径
- `apps/desktop/src/desktop-assets.spec.ts` 用 5 条静态契约测试守住这两点

## 3. 实测验证（2026-10-22）

```
# 窗口标题（能渲染页面时才会被前端改成这个）
工作台 · SciFlow

# CDP 实探渲染进程
root children: 2
body text: "SciFlow / 让科研从想法到成文 / 核心工作 / 工作台 / ..."
apiBase: http://127.0.0.1:54780
console errors: 0

# 路由切换（app:// 下 hash 路由正常）
#/chat len=406 · #/writing len=208 · #/literature len=574 · #/quality len=269 · #/settings len=1787
```

界面截图见 `docs/screenshots/desktop-workspace.png`。

## 4. 故障排查

| 现象 | 检查 | 处理 |
|---|---|---|
| 白屏 / 空白窗口 | `%APPDATA%\@sciflow\desktop\logs\desktop.log` 是否有 `did-fail-load` | 确认安装包由 `build:web`（`--base=./`）构建；重装 |
| 窗口标题是 `Error` | 同上 | 说明页面加载失败，看 desktop.log 的 code/desc |
| 显示「未选择项目」 | 正常：本地库为空 | 点右上「新建项目」 |
| 显示「AI 未配置」 | 正常：未填 Key | 设置页填 Base URL / Key（桌面端 Key 存本地 DB） |
| 内嵌后端起不来 | `logs/server.log` | 看是否有 `better-sqlite3` ABI 报错（打包时需按 Electron ABI 重编，`prepare-server.mjs` 已做） |
| 端口被占用 | 会自动选空闲端口 | 无需处理 |

## 5. 调试

```bash
# 带 CDP 调试端口启动（可用 playwright connectOverCDP 接管）
./SciFlow.exe --remote-debugging-port=9222
```

## 6. 打包

```bash
pnpm --filter @sciflow/desktop dist        # 完整安装包
pnpm --filter @sciflow/desktop dist:dir    # 仅解包目录（快速验证）
```

前置（脚本已自动执行）：`build:main`（tsc）→ `build:web`（vite --base=./）→ `prepare-server.mjs`（deploy/裁剪/校验）。
