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
