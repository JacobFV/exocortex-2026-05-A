import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentSessionArtifact, AgentSessionEvent, AgentSessionId } from "@exocortex/protocol";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase, Statement } from "better-sqlite3";

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

export class JsonFileAgentSessionStore implements AgentSessionStore {
  constructor(private readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
  }

  appendEvent(event: AgentSessionEvent): void {
    this.appendJsonLine(this.eventsPath(event.sessionId), event);
  }

  listSessionIds(): AgentSessionId[] {
    return readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name as AgentSessionId)
      .filter((sessionId) => this.listEvents(sessionId).length > 0);
  }

  listEvents(sessionId: AgentSessionId): AgentSessionEvent[] {
    return this.readJsonLines<AgentSessionEvent>(this.eventsPath(sessionId));
  }

  putArtifact(artifact: AgentSessionArtifact): void {
    this.appendJsonLine(this.artifactsPath(artifact.sessionId), artifact);
  }

  listArtifacts(sessionId: AgentSessionId): AgentSessionArtifact[] {
    return this.readJsonLines<AgentSessionArtifact>(this.artifactsPath(sessionId));
  }

  private eventsPath(sessionId: AgentSessionId): string {
    return join(this.rootDir, sessionId, "events.jsonl");
  }

  private artifactsPath(sessionId: AgentSessionId): string {
    return join(this.rootDir, sessionId, "artifacts.jsonl");
  }

  private appendJsonLine(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const existing = this.safeRead(path);
    writeFileSync(path, `${existing}${JSON.stringify(value)}\n`, "utf8");
  }

  private readJsonLines<T>(path: string): T[] {
    return this.safeRead(path)
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  }

  private safeRead(path: string): string {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
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
  private readonly appendEventStatement: Statement;
  private readonly listSessionIdsStatement: Statement;
  private readonly listEventsStatement: Statement;
  private readonly putArtifactStatement: Statement;
  private readonly listArtifactsStatement: Statement;

  constructor(dbPath: string, options: SQLiteAgentSessionStoreOptions = {}) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    if (options.wal ?? dbPath !== ":memory:") this.db.pragma("journal_mode = WAL");

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
      this.db.transaction(() => {
        migration.apply();
        this.db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(migration.version, migration.name);
      })();
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
