import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { projects, webProjects } from '../db/schema';
import { WebSandboxService } from './web-sandbox.service';

/**
 * 沙箱文件读写的契约（不触发 npm，只验证路径安全与内容往返）：
 *  - 项目内相对路径可读可写，内容原样往返；
 *  - `..` 穿越、绝对路径一律 400，否则就是一个任意文件写入漏洞；
 *  - 文件列表跳过 node_modules/dist（否则模型会被几万个文件淹没）。
 */
describe('WebSandboxService 文件读写', () => {
  let pid: string;
  let wpId: string;
  let svc: WebSandboxService;

  beforeEach(() => {
    pid = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: pid, name: '沙箱文件测试', description: '', createdAt: now, updatedAt: now }).run();
    svc = new WebSandboxService();
    const wp = svc.create({ projectId: pid, name: 'file-io', template: 'static' });
    wpId = wp.id;
  });

  afterEach(() => {
    svc.remove(wpId);
    db.delete(projects).where(eq(projects.id, pid)).run();
  });

  it('写入后读回内容一致，并出现在文件列表里', () => {
    const content = '<h1>改过的标题</h1>\n';
    const w = svc.writeFile(wpId, 'index.html', content);
    expect(w.ok).toBe(true);
    expect(w.bytes).toBe(Buffer.byteLength(content, 'utf-8'));

    const r = svc.readFile(wpId, 'index.html');
    expect(r.content).toBe(content);

    const files = svc.listFiles(wpId);
    expect(files.map((f) => f.path)).toContain('index.html');
    // 依赖与构建产物不应出现在列表里
    expect(files.some((f) => f.path.startsWith('node_modules/') || f.path.startsWith('dist/'))).toBe(false);
  });

  it('支持新建子目录下的文件', () => {
    svc.writeFile(wpId, 'src/pages/home.js', 'export const x = 1;\n');
    expect(svc.readFile(wpId, 'src/pages/home.js').content).toContain('export const x = 1;');
  });

  it('拒绝路径穿越（..）', () => {
    expect(() => svc.writeFile(wpId, '../escape.txt', 'x')).toThrow(/路径越界/);
    expect(() => svc.readFile(wpId, '../../etc/passwd')).toThrow(/路径越界/);
  });

  it('拒绝绝对路径', () => {
    expect(() => svc.writeFile(wpId, process.platform === 'win32' ? 'C:/Windows/temp/x.txt' : '/tmp/x.txt', 'x')).toThrow(/只接受相对路径/);
  });

  it('删除文件后不再可读', () => {
    svc.writeFile(wpId, 'temp.txt', 'bye');
    expect(svc.removeFile(wpId, 'temp.txt').ok).toBe(true);
    expect(() => svc.readFile(wpId, 'temp.txt')).toThrow(/文件不存在/);
  });

  it('读不存在的文件报 404 语义（NotFoundException）', () => {
    expect(() => svc.readFile(wpId, 'nope.txt')).toThrow(/文件不存在/);
  });

  it('项目不存在时抛错而不是静默成功', () => {
    expect(() => svc.writeFile('no-such-id', 'a.txt', 'x')).toThrow(/Web 项目不存在/);
  });
});
