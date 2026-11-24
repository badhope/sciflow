# SciFlow 1.19.18

这版没有加新入口。重点是把“真实模型能不能自己跑完一轮”和“CI 会不会被 runner 的环境问题拖死”这两件事，从偶然变成可复现。

## 已做完

- **单问题真实闭环连续两轮成功。** 只输入一个研究问题，真实网关跑完 PI 协议 → 专家门禁 → 沙箱实验 → Critic → `synthesize`，两轮结论都是 `supported` / confidence 95，全程没有人工审批。
  - cycle5 `230db717-bbd0-42c2-be8c-397775c75a61`：22,199 tokens；σ=0.05 组 r=0.996326，σ=2 组 r=0.293756。
  - cycle6 `582f9dad-c625-4817-92d3-9b3eb0d3594a`：16,681 tokens；σ=0.05 组 r=0.996290，σ=2 组 r=0.279082。
- **真实故障路径被写进代码，不再靠提示词祈祷。** 主模型空响应、返回中文键、返回英文同义键、把 confidence 写成“高（约 0.99）”，现在都能归一化；主模型重试耗尽会按 `AI_MODEL_FALLBACK` 切到 `glm-5.3`，不再直接 `blocked agent_error`。
- **CI 不再安装系统 ffmpeg。** 视频抽音轨用例优先用 `ffmpeg-static`，其次回退系统二进制，两者都没有才跳过；runner 的 `apt-get update` 不再决定三 job 是否全绿。
- **知识库命中分抽成纯函数。** `scoreLibraryHit` 从 731 行的 `pipeline.service.ts` 移到 `pipeline-metrics.ts`，补了标题全命中、摘要命中、空查询等 11 条单测。

## 门禁

- GitHub Actions `45335712825`：Types / Unit / Build、Full mock regression、E2E + prompt evals 三 job 全绿。
- server 972 passed / 1 skipped（140 files）；web 277 passed（51 files）。
- `full_regression.py` 237 PASS / 0 FAIL；lint、server typecheck、build 通过。

## 边界

- 真实网关仍会间歇空响应或超时。产品现在是 fail-closed 到 blocked，不编结果；这不等于“上游永远稳定”。
- 五个内容社区的发布状态以 `docs/COMMUNITY-LAUNCH-KIT.zh-CN.md` 的记录表为准，未发布的平台不写成已上线。
- 移动端 PWA 仍只在桌面 Chromium 验证，没有上真实 iOS / Android。
- 版本继续走 `1.19.x`。现在切 `0.0.x` 会断开已有 tag、Pages 和桌面安装包的发布链；品牌级重启时再统一迁。
