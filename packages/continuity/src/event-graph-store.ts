import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { ContinuityEvent, EventSourcedGraphStore } from "./event-graph-types.js";
export { InMemoryEventSourcedGraphStore } from "./in-memory-event-graph-store.js";

export const SQLITE_EVENT_GRAPH_SCHEMA_VERSION = 2;

export class SQLiteEventSourcedGraphStore implements EventSourcedGraphStore {
  private readonly db: SqliteDatabase;
  private readonly append: SqliteStatement;
  private readonly list: SqliteStatement;
  private readonly runs: SqliteStatement;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = openSqliteDatabase(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (dbPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS continuity_events_v2 (
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence),
        UNIQUE (run_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_continuity_events_v2_run_type ON continuity_events_v2(run_id, type);
    `);
    this.runMigrations();
    this.append = this.db.prepare(`
      INSERT INTO continuity_events_v2 (run_id, sequence, id, type, created_at, payload_json)
      VALUES (@runId, @sequence, @id, @type, @createdAt, @payloadJson)
      ON CONFLICT(run_id, sequence) DO NOTHING
    `);
    this.list = this.db.prepare("SELECT payload_json FROM continuity_events_v2 WHERE run_id = ? ORDER BY sequence, id");
    this.runs = this.db.prepare("SELECT DISTINCT run_id FROM continuity_events_v2 ORDER BY run_id");
  }

  close(): void {
    this.db.close();
  }

  listMigrations(): Array<{ version: number; name: string; applied_at: string }> {
    return this.db.prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version").all() as Array<{ version: number; name: string; applied_at: string }>;
  }

  appendEvent(event: ContinuityEvent): void {
    this.append.run({ runId: event.runId, sequence: event.sequence, id: event.id, type: event.type, createdAt: event.createdAt, payloadJson: JSON.stringify(event) });
  }

  listEvents(runId: string): ContinuityEvent[] {
    return this.list.all(runId).map((row) => JSON.parse((row as { payload_json: string }).payload_json) as ContinuityEvent);
  }

  listRuns(): string[] {
    return this.runs.all().map((row) => (row as { run_id: string }).run_id);
  }

  transaction<T>(fn: () => T): T {
    return runSqliteTransaction(this.db, fn);
  }

  private runMigrations(): void {
    const migrations: Array<{ version: number; name: string; apply: () => void }> = [
      {
        version: 1,
        name: "initial continuity event graph schema",
        apply: () => {}
      },
      {
        version: 2,
        name: "continuity event query indexes",
        apply: () => {
          this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_continuity_events_v2_run_created
              ON continuity_events_v2(run_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_continuity_events_v2_type_created
              ON continuity_events_v2(type, created_at);
          `);
        }
      }
    ];
    for (const migration of migrations) {
      const applied = this.db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(migration.version);
      if (applied) continue;
      runSqliteTransaction(this.db, () => {
        migration.apply();
        this.db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(migration.version, migration.name);
      });
    }
  }
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteStatement {
  run(...parameters: unknown[]): unknown;
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase;
}

function openSqliteDatabase(path: string): SqliteDatabase {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite") as SqliteModule;
  return new DatabaseSync(path);
}

function runSqliteTransaction<T>(db: SqliteDatabase, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
