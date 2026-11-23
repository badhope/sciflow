import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { MIGRATIONS, ensureColumn, runMigrations, type SchemaMigration } from './migrations';

function memoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_log (id TEXT PRIMARY KEY);
    CREATE TABLE pipeline_task (id TEXT PRIMARY KEY);
  `);
  return db;
}

function logger() {
  return { log: vi.fn(), warn: vi.fn() };
}

describe('schema migration ledger', () => {
  it('applies a migration once, records version and checksum, then no-ops', () => {
    const db = memoryDb();
    const log = logger();
    const applied = runMigrations(db, [MIGRATIONS[0]], log);
    expect(applied).toEqual([1]);
    expect(db.prepare('PRAGMA table_info(pipeline_task)').all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'trace' }),
        expect.objectContaining({ name: 'research_notice' }),
        expect.objectContaining({ name: 'research_meta' }),
      ]),
    );
    const ledger = db.prepare('SELECT version, name, checksum FROM schema_migration').all() as {
      version: number;
      name: string;
      checksum: string;
    }[];
    expect(ledger).toHaveLength(1);
    expect(ledger[0].version).toBe(1);
    expect(ledger[0].name).toBe('pipeline-memory-columns');
    expect(ledger[0].checksum).toMatch(/^[0-9a-f]{40}$/);
    expect(runMigrations(db, [MIGRATIONS[0]], log)).toEqual([]);
  });

  it('is idempotent when a legacy database already has the columns', () => {
    const db = memoryDb();
    db.exec(`
      ALTER TABLE pipeline_task ADD COLUMN trace TEXT DEFAULT '[]';
      ALTER TABLE pipeline_task ADD COLUMN research_notice TEXT;
      ALTER TABLE pipeline_task ADD COLUMN research_meta TEXT DEFAULT '';
    `);
    expect(() => runMigrations(db, [MIGRATIONS[0]])).not.toThrow();
    expect(db.prepare('PRAGMA table_info(pipeline_task)').all()).toHaveLength(4);
  });

  it('rejects a ledger entry whose migration disappeared', () => {
    const db = memoryDb();
    const custom: SchemaMigration = {
      version: 99,
      name: 'only-for-test',
      up: (d) => d.exec('CREATE TABLE IF NOT EXISTS test_only (id TEXT)'),
    };
    runMigrations(db, [custom]);
    expect(() => runMigrations(db, [])).toThrow(/未知迁移 v99/);
  });

  it('rejects changed signature of an applied migration', () => {
    const db = memoryDb();
    const first: SchemaMigration = { version: 7, name: 'signed', signature: 'v1', up: () => undefined };
    runMigrations(db, [first]);
    const changed: SchemaMigration = { version: 7, name: 'signed', signature: 'v2', up: () => undefined };
    expect(() => runMigrations(db, [changed])).toThrow(/代码已变更/);
  });

  it('ensureColumn skips missing tables instead of crashing startup', () => {
    const db = memoryDb();
    expect(() => ensureColumn(db, 'missing_table', 'x', 'TEXT')).not.toThrow();
  });

  it('v16 把旧 chat_session 摘要标记为 summary_only，并补完整会话列', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE chat_session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        summary TEXT DEFAULT '',
        message_count INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO chat_session VALUES ('legacy', 'p1', '旧摘要', 2, 10, 1000, 1000);
    `);
    const migration = MIGRATIONS.find((m) => m.version === 16);
    expect(migration).toBeTruthy();
    runMigrations(db, [migration!]);
    const row = db.prepare('SELECT * FROM chat_session WHERE id = ?').get('legacy') as Record<string, unknown>;
    expect(row.summary_only).toBe(1);
    expect(row.source).toBe('legacy-summary');
    expect(row.title).toBe('旧摘要');
    expect(row.messages_json).toBe('[]');
    expect(db.prepare('PRAGMA table_info(chat_session)').all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'messages_json' }),
        expect.objectContaining({ name: 'branch_json' }),
        expect.objectContaining({ name: 'pinned' }),
        expect.objectContaining({ name: 'archived' }),
        expect.objectContaining({ name: 'last_message_at' }),
      ]),
    );
  });

  it('v19 删除 project.templates 死字段且可重复执行', () => {
    const db = new Database(':memory:');
    db.exec("CREATE TABLE project (id TEXT PRIMARY KEY, templates TEXT DEFAULT '[]')");
    const migration = MIGRATIONS.find((m) => m.version === 19);
    expect(migration).toBeTruthy();
    runMigrations(db, [migration!]);
    const cols = db.prepare('PRAGMA table_info(project)').all() as { name: string }[];
    expect(cols.some((c) => c.name === 'templates')).toBe(false);
    expect(() => migration!.up(db)).not.toThrow();
  });
});
