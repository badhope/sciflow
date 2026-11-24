# B 站投稿包（SciFlow 1.19.18）

状态：**未上传**。B 站账号仍未登录，登录接管两次被跳过，不能写成已发布。

## 素材

- 视频：`../sciflow-launch-media/sciflow-demo-3min.mp4`
  - 180.14 秒，1920×1080，25fps，H.264 + AAC，约 8.2 MB。
  - 六段旁白：产品定位 → 项目驾驶舱 → 研究设计与驳回回边 → 知识库混合检索 → 质量门与写作 → 投稿包与发布。
- 封面：`../sciflow-launch-media/bilibili-cover.png`，1920×1080。
- 字幕：暂无独立 SRT；旁白已按六段各 30 秒对齐。

## 标题

**让 AI 自己跑一轮科研：提假设、跑实验、被驳回、改方案**

## 简介

SciFlow 是一个本地优先、可审计的 AI 科研工作台。它不只回答问题，而是把一轮科研拆成可回放的循环：提出假设、设计实验、接受驳回、改写方案、跑完质量门，最后交付投稿包。

这版 1.19.18 的重点是把真实模型闭环和 CI 环境问题变成可复现：单问题真实闭环连续两轮 `supported`，gateway 空响应会 fail-closed 到 blocked；Windows 安装包与 `latest.yml` 已随 GitHub Release 发布。

代码：https://github.com/badhope/sciflow
Release：https://github.com/badhope/sciflow/releases/tag/v1.19.18
基线：docs/PROJECT-BASELINE.zh-CN.md

## 标签

AI Agent、科研、开源、SQLite、本地优先、效率工具

## 分区与声明

- 分区：科技数码 → 计算机技术。
- 创作声明：含 AI 生成旁白；产品界面为真实截图，不是生成画面。
- 合集：开源实战、Agent 上线实战。

## 发布检查

- 上传前确认账号已登录、实名认证状态正常。
- 封面用 `bilibili-cover.png`，不要用默认截帧。
- 简介里的仓库与 Release 链接可点击。
- 发布后把 BV 号与公开链接回填 `docs/COMMUNITY-LAUNCH-KIT.zh-CN.md`。
