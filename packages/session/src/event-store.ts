import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { AgentSessionArtifact, AgentSessionEvent, AgentSessionId } from "@exocortex/protocol";

export interface AgentSessionStore {
  appendEvent(event: AgentSessionEvent): void;
  listSessionIds(): AgentSessionId[];
  listEvents(sessionId: AgentSessionId): AgentSessionEvent[];
  putArtifact(artifact: AgentSessionArtifact): void;
  listArtifacts(sessionId: AgentSessionId): AgentSessionArtifact[];
}

export class InMemoryAgentSessionStore implements AgentSessionStore {
  private readonly events = new Map<AgentSessionId, AgentSessionEvent[]>();
  private readonly artifacts = new Map<AgentSessionId, AgentSessionArtifact[]>();

  appendEvent(event: AgentSessionEvent): void {
    const events = this.events.get(event.sessionId) ?? [];
    events.push(event);
    this.events.set(event.sessionId, events);
  }

  listSessionIds(): AgentSessionId[] {
    return [...this.events.keys()];
  }

  listEvents(sessionId: AgentSessionId): AgentSessionEvent[] {
    return [...(this.events.get(sessionId) ?? [])];
  }

  putArtifact(artifact: AgentSessionArtifact): void {
    const artifacts = this.artifacts.get(artifact.sessionId) ?? [];
    artifacts.push(artifact);
    this.artifacts.set(artifact.sessionId, artifacts);
  }

  listArtifacts(sessionId: AgentSessionId): AgentSessionArtifact[] {
    return [...(this.artifacts.get(sessionId) ?? [])];
  }
}

export interface SQLiteAgentSessionStoreOptions {
  readonly wal?: boolean;
}

export const SQLITE_AGENT_SESSION_SCHEMA_VERSION = 2;

interface SerializedAgentSessionEventRow {
  readonly payload_json: string;
}

interface SerializedAgentSessionArtifactRow {
  readonly payload_json: string;
}

export class SQLiteAgentSessionStore implements AgentSessionStore {
  private readonly db: SqliteDatabase;
  private readonly appendEventStatement: SqliteStatement;
  private readonly listSessionIdsStatement: SqliteStatement;
  private readonly listEventsStatement: SqliteStatement;
  private readonly putArtifactStatement: SqliteStatement;
  private readonly listArtifactsStatement: SqliteStatement;

  constructor(dbPath: string, options: SQLiteAgentSessionStoreOptions = {}) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

    this.db = openSqliteDatabase(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA synchronous = NORMAL");
    if (options.wal ?? dbPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");

    this.initializeSchema();
    this.runMigrations();
    this.appendEventStatement = this.db.prepare(`
      INSERT INTO agent_session_events (id, session_id, sequence, type, created_at, payload_json)
      VALUES (@id, @sessionId, @sequence, @type, @createdAt, @payloadJson)
    `);
    this.listEventsStatement = this.db.prepare(`
      SELECT payload_json
      FROM agent_session_events
      WHERE session_id = ?
      ORDER BY sequence ASC, row_id ASC
    `);
    this.listSessionIdsStatement = this.db.prepare(`
      SELECT session_id
      FROM agent_session_events
      GROUP BY session_id
      ORDER BY MIN(row_id) ASC
    `);
    this.putArtifactStatement = this.db.prepare(`
      INSERT INTO agent_session_artifacts (id, session_id, kind, title, created_at, payload_json)
      VALUES (@id, @sessionId, @kind, @title, @createdAt, @payloadJson)
    `);
    this.listArtifactsStatement = this.db.prepare(`
      SELECT payload_json
      FROM agent_session_artifacts
      WHERE session_id = ?
      ORDER BY row_id ASC
    `);
  }

  appendEvent(event: AgentSessionEvent): void {
    this.appendEventStatement.run({
      id: event.id,
      sessionId: event.sessionId,
      sequence: event.sequence,
      type: event.type,
      createdAt: event.createdAt,
      payloadJson: JSON.stringify(event)
    });
  }

  listEvents(sessionId: AgentSessionId): AgentSessionEvent[] {
    return this.listRows<AgentSessionEvent>(this.listEventsStatement.all(sessionId) as SerializedAgentSessionEventRow[], "event");
  }

  listSessionIds(): AgentSessionId[] {
    return (this.listSessionIdsStatement.all() as Array<{ session_id: string }>).map((row) => row.session_id as AgentSessionId);
  }

  putArtifact(artifact: AgentSessionArtifact): void {
    this.putArtifactStatement.run({
      id: artifact.id,
      sessionId: artifact.sessionId,
      kind: artifact.kind,
      title: artifact.title,
      createdAt: artifact.createdAt,
      payloadJson: JSON.stringify(artifact)
    });
  }

  listArtifacts(sessionId: AgentSessionId): AgentSessionArtifact[] {
    return this.listRows<AgentSessionArtifact>(this.listArtifactsStatement.all(sessionId) as SerializedAgentSessionArtifactRow[], "artifact");
  }

  close(): void {
    this.db.close();
  }

  listMigrations(): Array<{ version: number; name: string; applied_at: string }> {
    return this.db.prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version").all() as Array<{ version: number; name: string; applied_at: string }>;
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS agent_session_events (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        inserted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (session_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS agent_session_events_session_sequence_idx
        ON agent_session_events (session_id, sequence);

      CREATE TABLE IF NOT EXISTS agent_session_artifacts (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        inserted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS agent_session_artifacts_session_row_idx
        ON agent_session_artifacts (session_id, row_id);

      CREATE INDEX IF NOT EXISTS agent_session_artifacts_id_idx
        ON agent_session_artifacts (id);
    `);
  }

  private runMigrations(): void {
    const migrations: Array<{ version: number; name: string; apply: () => void }> = [
      {
        version: 1,
        name: "initial agent session event/artifact schema",
        apply: () => {}
      },
      {
        version: 2,
        name: "agent session query indexes",
        apply: () => {
          this.db.exec(`
            CREATE INDEX IF NOT EXISTS agent_session_events_type_created_idx
              ON agent_session_events (type, created_at);
            CREATE INDEX IF NOT EXISTS agent_session_artifacts_kind_created_idx
              ON agent_session_artifacts (kind, created_at);
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

  private listRows<T>(rows: Array<{ payload_json: string }>, rowType: string): T[] {
    return rows.map((row) => {
      try {
        return JSON.parse(row.payload_json) as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse persisted agent session ${rowType}: ${message}`);
      }
    });
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

export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

export class AgentSessionEventBus {
  private readonly listenersBySession = new Map<AgentSessionId | "*", Set<AgentSessionEventListener>>();

  subscribe(sessionId: AgentSessionId | "*", listener: AgentSessionEventListener): () => void {
    const listeners = this.listenersBySession.get(sessionId) ?? new Set<AgentSessionEventListener>();
    listeners.add(listener);
    this.listenersBySession.set(sessionId, listeners);
    return () => listeners.delete(listener);
  }

  publish(event: AgentSessionEvent): void {
    for (const listener of this.listenersBySession.get("*") ?? []) listener(event);
    for (const listener of this.listenersBySession.get(event.sessionId) ?? []) listener(event);
  }
}
