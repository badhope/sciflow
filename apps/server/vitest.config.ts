import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

/**
 * 测试进程隔离数据库
 *
 * 历史问题（2026-10-20 复现两次）：多个 spec 文件并行跑在各自 worker 里，
 * 却共用 `apps/server/data/sciflow.db`。WAL 模式下并发写仍会抛
 * `SqliteError: disk I/O error`（busy_timeout 只能缓解锁等待，救不了 WAL 层错误），
 * 表现为「随机某个 spec 文件失败、重跑又绿」——CI 上就是偶发红。
 *
 * 这里给每个 vitest 进程分配独立数据库文件，按 worker 序号 + pid 命名；
 * 进程退出时随临时目录清理（temp 目录由 OS 回收）。
 */
const testDb = path.join(os.tmpdir(), `sciflow-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = testDb;
// 测试不应加载 384 维本地嵌入模型（慢且非必需）；检索用例走 FTS5 路径
process.env.SCIFLOW_NO_VEC = process.env.SCIFLOW_NO_VEC ?? '1';
process.env.SCIFLOW_SECRET = process.env.SCIFLOW_SECRET ?? 'test-only-secret-not-for-production';

export default defineConfig({
  test: {
    // 同时扫描接口层(src)与能力层(packages)的测试。
    // 历史问题：只 include 'src/**/*.spec.ts'，导致 packages/ 下的测试从未被执行——
    // 写了等于没写（静默不被发现）。
    // 同时扫描接口层(src)、能力层(packages)与桌面端契约测试(apps/desktop/src)。
    // 桌面端白屏回归（2026-10-22）就是缺这层静态契约测试才漏到用户手里。
    include: ['src/**/*.spec.ts', '../../packages/*/src/**/*.spec.ts', '../desktop/src/**/*.spec.ts'],
    environment: 'node',
    // 共用一份依赖图（isolate: false）：本项目 spec 均为纯函数/服务级用例，
    // 不依赖模块级可变状态（DB 已按进程隔离）。实测 40 个 spec 的 import 开销占 85% 时长，
    // 关掉隔离后总耗时下降约 40%，且不改变任何断言语义。
    isolate: false,
    // 共享同一个 SQLite 文件的 spec 必须串行，否则 WAL 层并发写会随机 I/O error。
    fileParallelism: false,
  },
});
