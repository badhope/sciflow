# SciFlow 品牌指南（Brand Guidelines）

> 版本 1.0 · 2026-10-09
> 本指南是 SciFlow 品牌视觉的唯一事实来源。所有端（Web / 桌面 / 文档 / 周边物料）一律遵循本规范。

---

## 1. 品牌 Core

| 项 | 内容 |
|---|---|
| 名称 | SciFlow（Sci + Flow） |
| 中文定位 | 科研全流程 AI 助手 · 让科研从想法到成文 |
| 品牌隐喻 | **流体**：科研流程如水流动——文献汇聚、思路成形、落笔成文。贯穿 Logo、渐变、动效（呼吸点、流光、页面淡入） |
| 性格 | 专业、轻盈、流畅、可信；避免 AI 产品惯用的紫色系与赛博朋克风 |

## 2. Logo

### 2.1 构成

Logo 主体为**一笔流线 "S"**：起笔于右上、收笔于左下，三段贝塞尔曲线一气呵成——

- **S** = SciFlow 首字母；
- 一笔贯通 = 科研全流程（调研 → 规划 → 起草 → 评审 → 润色 → 投稿）不断点；
- 圆头端点 = 流体的柔性与包容；
- 渐变底色 = 知识从青涩（teal）流向成熟（sky）。

### 2.2 资产清单（唯一源文件，禁止手改位图）

| 文件 | 用途 |
|---|---|
| `docs/brand/icon-master.svg` | **App 图标母版**（1024×1024），PNG/ICO/ICNS 由此渲染 |
| `docs/brand/logo-mark.svg` | 独立标志（品牌渐变流线 S），浅色底 |
| `docs/brand/logo-mark-light.svg` | 独立标志（纯白流线 S），深色/照片底 |
| `docs/brand/logo-horizontal.svg` | 横版组合（标志 + 词标 + 标语），README/官网/文档封面 |
| `apps/web/public/favicon.svg` | 浏览器标签图标（与母版同源缩放） |
| `apps/web/public/apple-touch-icon.svg` | iOS/移动端添加主屏图标 |
| `apps/desktop/build/icon.png` | 桌面端安装包图标（由脚本从母版生成） |

再生成位图：`pnpm icons`（内部调用 `scripts/generate-icons.mjs`，基于 resvg 矢量渲染）。

### 2.3 使用规范

- **最小尺寸**：标志 20px；横版组合 220px 宽。
- **安全边距**：标志四周留出 ≥ 1/4 高度的空白。
- **背景**：
  - 浅色底 → 用 `logo-mark.svg`（渐变描边版）；
  - 深色底/品牌渐变底 → 用 `logo-mark-light.svg`（纯白描边版）；
  - 不得把渐变描边版放在品牌渐变底上（撞色）。
- **禁止**：拉伸变形、改描边粗细、换非品牌色、加阴影/描边/发光滤镜、把词标字体替换为手写体。

## 3. 色彩

### 3.1 品牌渐变（主视觉）

```
teal  #0b8079  →  cyan #0a7896  →  sky #0b6fc4    （135° 线性）
```

暗色模式下整体提亮一档：

```
teal  #2dd4bf  →  cyan #22d3ee  →  sky #38bdf8    （135° 线性）
```

### 3.2 Token 对照表（与 `apps/web/src/index.css` 一一对应）

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--brand-400/500/600` | #14b8a6 / #0f9e94 / #0b7f78 | — | 强调色、聚焦环、边框辉光 |
| `--brand-700` | #0b6f68 | #5eead4 | 正文级品牌文字（白底 4.86:1，达 WCAG AA） |
| `--on-brand` | #ffffff | #04211f | 品牌渐变上的文字色（亮色 4.8–5.1:1，暗色 6.8–9.4:1） |
| `--brand-grad` | teal→cyan→sky 135° | 提亮版 | 主按钮、导航高亮、Logo 底、渐变文字 |
| `--brand-grad-soft` | 8%–10% 透明度 | 9%–12% | 页面区块氛围底、选中态淡底 |
| `--brand-glow` | teal/cyan 双层投影 | 提亮版 | `brand-btn` / `brand-logo` / `nav-active` |
| `--card-shadow` | 双层卡片阴影 | 深色版 | 所有 Card |
| `--bg-app` | #f4f6fb | #0b1220 | 应用背景 |
| `--ink` | #1c2a44 | #e2e8f0 | 正文墨色 |
| `theme-color`（meta） | 随主题变化 | — | 由 `applyTheme()` 按 风格 × 明暗 写入（v1.7，此前恒为 #0d9488） |

### 3.3 语义色

- 成功/保存：品牌绿（emerald 系）
- 警示：amber 系；错误：rose 系（遵循 Tailwind 默认语义，不另造色板）

## 4. 字体

| 场景 | 字体栈 |
|---|---|
| 界面正文 | `-apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`（零网络依赖，不引外部字体） |
| 代码 / kbd | `ui-monospace, SFMono-Regular, Menlo, monospace` |
| 词标（横版 Logo 中） | 同界面字体栈，weight 700，字距 -0.5 |

> 原则：**不引入网络字体**。前端体积红线（首屏 JS 821KB、dist ≈2.2MB）高于字体美学。

## 5. 品牌组件类（CSS 契约）

以下类名是品牌落地组件，各端复用、不得绕开重写：

| 类 | 用途 |
|---|---|
| `brand-logo` | 渐变徽标底 + 内发光（Logo 容器、步骤徽章） |
| `brand-btn` | 主按钮（渐变底 + 辉光 + 按压缩放） |
| `brand-gradient-text` | 渐变文字裁切 |
| `nav-active` | 侧边导航活跃项 |
| `brand-divider` | 模块间渐变分割线 |
| `brand-breathe` | 运行态呼吸点（流水线 running） |
| `glass-header` | 顶栏玻璃质感 |
| `card-lift` / `card-glow` | 可交互卡 hover 上浮 / 辉光 |
| `input-focus-ring` / 全局 focus-visible | 品牌色聚焦环 |
| `page-in` / `modal-in` / `toast-in` | 入场动效（轻、快、不抢内容） |

## 6. 动效原则

1. **快而不跳**：入场 150–220ms，缓出优先；
2. **有生命感**：运行态用呼吸/流光表达"AI 在工作"（`brand-breathe`、`pulse-dot`、`skeleton`）；
3. **克制**：一次只允许一个持续动画元素聚焦视线；`prefers-reduced-motion` 场景下应可全部退化（后续统一补齐）。

## 7. 文案与语调

- **中文为主**，句末不加句号；错误信息一律中文转译（已有统一转译层），不裸露英文技术词。
- 标语体系：
  - 主标语：**让科研从想法到成文**
  - 桌面端启动页/关于页可复用主标语；不得自行发明新 slogan。
- 自称统一为 **SciFlow**（连写、S/F 大写）；不写 Sci-flow / sciflow / 思流。
- 提及 AI 能力时不夸大：说"辅助生成/辅助润色"，不说"全自动替代研究者"。

## 8. 各端落地要求

| 端 | 必须落实 |
|---|---|
| Web | favicon.svg / apple-touch-icon / theme-color / 侧栏品牌标志 / 品牌组件类 / 6 套主题风格包（`styles/themes.css`） |
| 桌面端 | 窗口图标（build/icon.png）、安装包图标（NSIS/DMG）、产品名 "SciFlow"、启动backgroundColor `#f4f6fb`（避免白闪）、关于页 Logo 横版 |
| 文档 | README 头图用横版组合；截图以默认「科研青绿」亮色为主，多主题截图见 `out/` |
| 导出物（MD/DOCX/HTML） | 模板页眉/封面可放横版 Logo；文档属性作者写 "SciFlow" |

## 9. 变更流程

品牌资产（本目录、favicon、品牌 CSS token）的任何改动必须：

1. 同步更新本指南版本号与日期；
2. 跑 `pnpm icons` 重新生成全部位图；
3. 在 CHANGELOG.md 记录；
4. 截图对比桌面端安装包图标与 Web 侧栏，确保同源一致。
