import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentSessionArtifact, AgentSessionArtifactId, AgentSessionEvent, AgentSessionId } from "@exocortex/protocol";

export interface AgentSessionStore {
  appendEvent(event: AgentSessionEvent): void;
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
