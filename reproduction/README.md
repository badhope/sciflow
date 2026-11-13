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

## 三角色研究循环（规则驱动骨架）

`run-cycle.mjs` 串联 PI / Experimenter / Critic：

```bash
node reproduction/run-cycle.mjs \
  --api http://127.0.0.1:43100 \
  --program <programId> \
  --case reproduction/cases/plass-stone-1983.json \
  --question "该复现是否可稳定重跑？" \
  --auto-approve \
  --uv "C:/Program Files/Python315/Scripts/uv.exe" \
  --repo-cache D:/sciflow-research/data/reproduction/plass-stone-1983/repo \
  --runs 2
```

流程：

```text
PI: 问题 → 假设 → 协议（--auto-approve 才自动批准）
Experimenter: run-case.mjs → publish-run.mjs
Critic: 读 manifest → 判断确定性/指标 → Claim + Evidence（verified）
```

- 无 `--auto-approve` 时只创建到协议并退出，等待人工批准（符合 L2 默认）。
- `--repo-cache` 用于弱网/离线：从已审阅的本地镜像 clone，仍校验 commit。
- 当前角色决策是规则驱动；后续把 PI/Critic 换成 LLM 即可，API 与数据流不变。
- 不自动投稿、不调用外部模型。

## 经济学多轮循环（Card 1995）

`run-econ-loop.mjs` 用同一套 API 跑**多轮**“协议 → 实验 → 评判 → 修订”：

```bash
node reproduction/run-econ-loop.mjs \
  --api http://127.0.0.1:43100 \
  --program <programId> \
  --case reproduction/cases/card-1995-returns-schooling.json \
  --python D:/sciflow-research/data/reproduction/econ/venv/Scripts/python.exe \
  --question "Card (1995) 教育回报率的 OLS 与 IV 估计能否复现？" \
  --auto-approve --max-cycles 2
```

- 数据来自 `wooldridge` 包内置 `card`，无外部下载；纯 CPU，秒级；
- 第一轮 `naive`（遗漏控制变量）OLS=0.052，被 Critic 判 `refuted`；
- 第二轮 `controlled`（控制变量 + `nearc4` IV）OLS=0.074、IV=0.132，判 `supported`；
- 失败轮与成功轮都保留 Cycle/Run/Claim/Evidence，形成修订轨迹。

## 后续

1. 将 manifest 写入 `research_run`（通过 `/api/programs/:id/runs` 或服务层）。
2. 增加指标比对（原文数值 vs 复现值）与误差阈值，而不仅是产物哈希。
3. 增加依赖锁定文件（把首次 freeze 回写 case，后续固定版本）。
4. 接入隔离执行器（容器/VM/远程），替换当前进程级执行。
