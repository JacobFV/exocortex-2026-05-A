import {
  createId,
  type AgentRuntimeRef,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionEventPayload,
  type AgentSessionId,
  type AgentSessionModalityId,
  type AgentSessionState
} from "@exocortex/protocol";
import type { AgentRuntime } from "./agent-runtime.js";
import { MockAgentRuntime } from "./agent-runtime.js";
import type { AgentSessionStore } from "./event-store.js";
import { InMemoryAgentSessionStore } from "./event-store.js";

export interface CreateAgentSessionInput {
  goal: string;
  title?: string;
  runtime?: AgentRuntimeRef;
  modalityIds?: AgentSessionModalityId[];
  metadata?: Record<string, unknown>;
}

export interface AgentSessionManagerOptions {
  store?: AgentSessionStore;
  runtime?: AgentRuntime;
}

export class AgentSessionManager {
  private readonly sessions = new Map<AgentSessionId, AgentSession>();
  private readonly abortControllers = new Map<AgentSessionId, AbortController>();
  private readonly store: AgentSessionStore;
  private readonly runtime: AgentRuntime;

  constructor(options: AgentSessionManagerOptions = {}) {
    this.store = options.store ?? new InMemoryAgentSessionStore();
    this.runtime = options.runtime ?? new MockAgentRuntime();
  }

  create(input: CreateAgentSessionInput): AgentSession {
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: createId<"AgentSessionId">("sess"),
      goal: input.goal,
      title: input.title,
      state: "idle",
      runtime: input.runtime ?? { provider: "mock", model: "mock-agent-runtime" },
      modalityIds: input.modalityIds ?? [],
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata
    };

    this.sessions.set(session.id, session);
    this.emit(session.id, { type: "session.created", goal: session.goal });
    return session;
  }

  get(sessionId: AgentSessionId): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? { ...session, modalityIds: [...session.modalityIds] } : undefined;
  }

  list(): AgentSession[] {
    return [...this.sessions.values()].map((session) => ({ ...session, modalityIds: [...session.modalityIds] }));
  }

  async start(sessionId: AgentSessionId): Promise<void> {
    const session = this.requireSession(sessionId);
    if (session.state === "running") return;

    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);
    this.transition(sessionId, "starting");
    this.patch(sessionId, { startedAt: new Date().toISOString() });
    this.transition(sessionId, "running");

    try {
      await this.runtime.start({
        session: this.requireSession(sessionId),
        signal: controller.signal,
        emit: (event) => this.emit(sessionId, event)
      });

      if (!controller.signal.aborted) {
        this.finish(sessionId, true, "Agent runtime completed.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown agent runtime error";
      this.fail(sessionId, "agent_runtime_error", message, true);
    } finally {
      this.abortControllers.delete(sessionId);
    }
  }

  pause(sessionId: AgentSessionId): void {
    this.transition(sessionId, "paused");
  }

  resume(sessionId: AgentSessionId): void {
    this.transition(sessionId, "running");
  }

  stop(sessionId: AgentSessionId, reason = "Stopped by host"): void {
    this.abortControllers.get(sessionId)?.abort(reason);
    this.transition(sessionId, "stopped");
  }

  bindModality(sessionId: AgentSessionId, modalityId: AgentSessionModalityId): void {
    const session = this.requireSession(sessionId);
    if (session.modalityIds.includes(modalityId)) return;
    this.patch(sessionId, { modalityIds: [...session.modalityIds, modalityId] });
  }

  observe(sessionId: AgentSessionId, modalityId: AgentSessionModalityId, observationType: string, value: unknown): AgentSessionEvent {
    return this.emit(sessionId, { type: "modality.observation", modalityId, observationType, value });
  }

  act(sessionId: AgentSessionId, modalityId: AgentSessionModalityId, actionType: string, value: unknown): AgentSessionEvent {
    return this.emit(sessionId, { type: "modality.action", modalityId, actionType, value });
  }

  events(sessionId: AgentSessionId): AgentSessionEvent[] {
    this.requireSession(sessionId);
    return this.store.listEvents(sessionId);
  }

  private finish(sessionId: AgentSessionId, success: boolean, summary?: string): void {
    this.emit(sessionId, { type: "session.finished", success, summary });
    this.patch(sessionId, { finishedAt: new Date().toISOString() });
    this.transition(sessionId, "finished");
  }

  private fail(sessionId: AgentSessionId, code: string, message: string, recoverable?: boolean): void {
    this.emit(sessionId, { type: "session.error", code, message, recoverable });
    this.patch(sessionId, { error: { code, message, recoverable }, finishedAt: new Date().toISOString() });
    this.transition(sessionId, "error");
  }

  private transition(sessionId: AgentSessionId, nextState: AgentSessionState): void {
    const session = this.requireSession(sessionId);
    const previousState = session.state;
    if (previousState === nextState) return;
    this.patch(sessionId, { state: nextState });
    this.emit(sessionId, { type: "session.state_changed", previousState, nextState });
  }

  private patch(sessionId: AgentSessionId, patch: Partial<AgentSession>): void {
    const session = this.requireSession(sessionId);
    this.sessions.set(sessionId, { ...session, ...patch, updatedAt: new Date().toISOString() });
  }

  private emit(
    sessionId: AgentSessionId,
    event: AgentSessionEventPayload
  ): AgentSessionEvent {
    const sequence = this.store.listEvents(sessionId).length + 1;
    const fullEvent = {
      ...event,
      id: createId<"AgentSessionEventId">("evt"),
      sessionId,
      sequence,
      createdAt: new Date().toISOString()
    } as AgentSessionEvent;
    this.store.appendEvent(fullEvent);
    return fullEvent;
  }

  private requireSession(sessionId: AgentSessionId): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown agent session: ${sessionId}`);
    return session;
  }
}
