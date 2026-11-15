# 复现 Harness（阶段 3）

## 目的

把“论文复现”变成可审计、可重跑的研究运行：

- 锁定仓库 commit、Python 版本、依赖 freeze；
- 在独立目录运行，不污染项目源码；
- 记录命令、耗时、stdout/stderr、产物 SHA-256；
- 默认跑两遍，产物哈希一致才判定确定性通过；
- 产出 `manifest.json`，后续可写入 `research_run.manifest`。

## 首个案例

`cases/plass-stone-1983.json`

- 原文：Plass & Stone, *Curve-fitting with piecewise parametric cubics*, SIGGRAPH 1983, DOI `10.1145/800059.801153`
- 复现：ReScience C, `[Re] Curve-Fitting with Piecewise Parametric Cubics`
- 代码：https://github.com/danperazzo/plass_reproduction
- commit：`d19b930a02274aa45ea547c71d0039e4722c1c7a`
- 许可：MIT
- 依赖：Python 3.12 + NumPy/Matplotlib/tqdm
- 特点：CPU、无网络、输出确定；以“产物齐全 + 重复运行哈希一致”为判据
- 依赖锁定：`cases/plass-stone-1983.lock.txt`（13 项精确版本）；NumPy 必须 1.x，NumPy 2.x 移除了仓库使用的二维 `np.cross` 行为

## 运行

在项目根目录：

```bash
node reproduction/run-case.mjs \
  --case reproduction/cases/plass-stone-1983.json \
  --workdir D:/sciflow-research/data/reproduction-runs \
  --uv "C:/Program Files/Python315/Scripts/uv.exe" \
  --runs 2
```

如果 `uv` 已在 PATH，可省略 `--uv`。

## 隔离边界

| 内容 | 位置 |
|---|---|
| 复现运行目录 | `D:\sciflow-research\data\reproduction-runs\<case>-<timestamp>` |
| 克隆仓库 | 运行目录下 `repo/` |
| Python venv | 运行目录下 `venv/` |
| uv 管理的 Python | `D:\sciflow-research\tools\uv-python` |
| uv 缓存 | `D:\sciflow-research\cache\uv` |
| 产物副本 | 运行目录下 `artifacts/run-N/` |
| manifest | 运行目录下 `manifest.json` |

不在系统 Python 中安装包，不修改全局环境。首次运行会下载 Python 3.12 与依赖，需要网络；之后复用缓存。

## 安全说明

- 仓库代码在克隆后、运行前应人工/静态审阅；当前案例已确认无网络调用、无 subprocess、无写仓库外路径。
- 运行环境设置 `MPLBACKEND=Agg`，避免 `plt.show()` 阻塞。
- 当前是进程级隔离，不是安全沙箱；不可信代码仍需容器/VM，暂不在本 harness 范围。
- harness 不读取模型密钥，不把环境变量透传给复现脚本（仅传 HOME/TMP/编码等基础变量）。

## 输出解读

`manifest.status`：

- `completed`：全部命令成功，且多遍产物哈希一致；
- `determinism-mismatch`：命令成功但重复运行产物哈希不同；
- 进程在失败时退出码非 0，manifest 保留已完成的步骤。

`manifest.determinism.comparisons[]` 记录每个产物在各遍的 SHA-256 与是否一致。

## 发布到 research_run

把 manifest 发布到驾驶舱（需 API 已启动）：

```bash
node reproduction/publish-run.mjs \
  --manifest D:/sciflow-research/data/reproduction-runs/<run>/manifest.json \
  --program <programId> \
  --cycle <cycleId> \
  --api http://127.0.0.1:43100
```

行为：

- 只发布摘要、commit、Python/依赖、确定性比较、产物哈希，不写全量 stdout/stderr；
- `determinism.allEqual=false` 时发布为 `failed`；
- 写入 manifest 的 `startedAt/endedAt`，驾驶舱显示真实运行时间；
- `--dry-run` 只打印 payload，不发请求。

## 编排归位（不再由脚本编排）

`run-cycle.mjs` / `run-econ-loop.mjs` 这两个**规则驱动编排脚本已删除**。
多轮「问题 → 假设 → 协议 → 实验 → 评审 → 修订」现在由服务端 LangGraph 承担：

- 图：`apps/server/src/research-cycle/research-cycle.graph.ts`（带回边与终止条件）
- API：`POST /api/research-cycles/start`、`POST /api/research-cycles/:id/resume`、`GET /api/research-cycles/:id`
- 角色：`apps/server/src/research-cycle/agents/{pi,experimenter,critic,expert}.agent.ts`（真实 LLM）
- 门禁：L2 人工审批（`interrupt`）或全自动 AI 专家审批

保留的两个脚本只做**执行器**，不再包含任何编排决策：

| 脚本 | 职责 | 不做什么 |
|---|---|---|
| `run-case.mjs` | 克隆固定 commit、建 venv、跑两遍、比对产物哈希、写 `manifest.json` | 不做角色决策、不写 Claim/Evidence |
| `publish-run.mjs` | 把 manifest 摘要发布为 `research_run` | 不判断结论、不改 Claim 状态 |

用法不变：

```bash
# 1) 执行一次可复现运行（纯执行器）
node reproduction/run-case.mjs \
  --case reproduction/cases/plass-stone-1983.json \
  --workdir D:/sciflow-research/data/reproduction-runs \
  --uv "C:/Program Files/Python315/Scripts/uv.exe" \
  --runs 2

# 2) 把 manifest 发布为 research_run
node reproduction/publish-run.mjs --api http://127.0.0.1:43100 --program <programId> --manifest <path>
```

需要多轮自动研究时，走研究循环 API，不要再在仓库外写循环脚本。

## 后续

1. 将 manifest 写入 `research_run`（通过 `/api/programs/:id/runs` 或服务层）。
2. 增加指标比对（原文数值 vs 复现值）与误差阈值，而不仅是产物哈希。
3. 增加依赖锁定文件（把首次 freeze 回写 case，后续固定版本）。
4. 接入隔离执行器（容器/VM/远程），替换当前进程级执行。
