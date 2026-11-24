# 一个 SQLite 文件，装下一整轮科研

整理旧项目时，我发现自己电脑里躺着七个数据库：笔记一个、文献一个、实验记录一个、写作版本一个，还有三个是“当时觉得以后会用”的向量库。

每个都能用，合起来不能用。你没法在一个查询里回答“这条结论对应哪次实验、哪篇文献、哪一版稿子”，因为它们根本不在一个世界。

SciFlow 一开始就选了一个很土的做法：全部塞进一个 SQLite 文件。

## 为什么不是 Postgres

不是 SQLite 更强，是这台机器上只有一个人。

个人科研工作台的并发量，大概就是“我一边写稿，一边让 Agent 跑实验”。Postgres 能给你连接池、行锁、复杂查询、扩展生态，也能给你一个需要维护的服务、一套要备份的账号、一个“为什么连不上”的深夜。

SQLite 的代价很明确：写并发有限，复杂分析弱，跨机器协作基本别想。收益也很明确：一个文件就是全部状态。拷走它，项目、文献、实验、claim、checkpoint 一起走；删掉它，不会留下半个项目在另一个库里。

对一个本地优先的工具，这个交换划算。

## 这个文件里有什么

不是把聊天记录存下来就完事。核心表按科研对象组织：

```text
projects
  └─ programs
       └─ cycles
            ├─ questions
            ├─ hypotheses
            ├─ protocols
            ├─ runs
            └─ claims
                 └─ evidence
```

再加几张“基础设施”表：

- `references` / `knowledge_chunks`：文献与知识块；
- `knowledge_chunk_fts`：FTS5 词面索引；
- `knowledge_chunks_embedding`：sqlite-vec 的 `vec0` 虚拟表；
- `checkpoints`：LangGraph 的断点；
- `llm_call_log`：每次模型调用的 token、耗时、caller；
- `app_settings`：模型、检索、审批模式。

它们共享同一个事务边界。这一点在长跑 Agent 里很关键：你不能出现“claim 写进去了，但对应 run 还在另一个库里半截”的状态。

## 断点和业务数据必须住在一起

研究循环会在审批节点挂起，可能挂几个小时。checkpoint 如果单独放 Redis 或内存，服务重启后就会出现两种糟糕情况：

1. 业务表说“审批中”，checkpoint 没了，人批准后无法续跑；
2. checkpoint 还在，业务表被回滚，Agent 从旧状态继续，写出重复 claim。

把 checkpoint 放同一个 SQLite 后，启动恢复可以一次扫描：

- `awaiting_approval`：保留，不自动跑；
- 有 checkpoint：从最后提交的节点续跑；
- 无 checkpoint：标 `blocked`，保留已有 claim/run，提示重新开始。

看门狗也只做一件事：超过设定时间没有心跳，释放运行锁，标 `blocked`，保留断点等人手动恢复。它不会“智能地”再跑一遍。长跑系统里，自动重跑往往比停下来更贵。

## 备份不是导出，是整库拷贝

SQLite 的备份门槛低，但坑也集中在这里。

正确姿势是用 `scripts/backup-db.mjs`，它走 SQLite 的 backup API，不是 `cp`。如果手工恢复，记得把同目录的 `-wal` / `-shm` 一起处理掉：

```bash
node scripts/backup-db.mjs --keep 7
# 恢复：替换 sciflow.db 后，删除旧的 sciflow.db-wal / sciflow.db-shm
```

只换主文件、留下旧 WAL，是 SQLite 最经典的“看起来能打开，状态已经错了”。

## 单文件也能有像样的检索

很多人以为 SQLite 只能 `LIKE`。其实加上 `sqlite-vec` 和 FTS5，单机也可以做混合检索：

- ANN 语义召回走 `vec0`；
- 词面召回走 FTS5；
- 两路 RRF 融合，k=60；
- 可选 LLM rerank，默认关闭；
- MMR 去冗余，压掉同一文档相邻块的重复。

1 万条文档的基准里，service 文档检索 P95 1.26 ms，全类型 3.90 ms，HTTP 4.44 ms。这个数字放到集群里不值一提，但对一个每天开着的工作台，已经比“等云端索引转圈”舒服。

## 它的边界，也要写清楚

单文件不是万能：

- 多人实时协作不要指望它。SQLite 的写锁会让两个人同时改稿变成排队。
- 嵌入模型换维度时，`vec0` 表要重建；这不是热更新，得停机迁移。
- 数据库超过几个 GB 后，备份和启动都会变慢；该拆还是得拆。
- 它不是“永不丢数据”。磁盘坏了就是坏了，备份要另存一份，别和主库放同一个盘。

我把这些边界写在 `docs/OPERATIONS.zh-CN.md`，不是为了显得诚实，是因为不写清楚，用户就会在第一次磁盘满的时候骂娘。

## 为什么还在坚持

因为科研工作流最贵的东西不是算力，是“我三个月前为什么改了这版协议”。

一个 SQLite 文件，能把这个问题回答到 `run → stdout → claim → evidence` 这一层。你可以用任何 SQLite 工具打开它，不用先装一个平台、登一个账号、等一次索引。

它不优雅，但它属于你。

SciFlow 1.19.18：<https://github.com/badhope/sciflow>
运维与备份：`docs/OPERATIONS.zh-CN.md`
