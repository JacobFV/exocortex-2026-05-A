import {
  createId,
  type AgentRuntimeRef,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionEventPayload,
  type AgentSessionId,
  type AgentSessionModalityBinding,
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
  modalityBindings?: AgentSessionModalityBinding[];
  metadata?: Record<string, unknown>;
}

export interface AgentSessionManagerOptions {
  store?: AgentSessionStore;
  runtime?: AgentRuntime;
}

export class AgentSessionManager {
  private readonly sessions = new Map<AgentSessionId, AgentSession>();
  private readonly bindings = new Map<AgentSessionId, AgentSessionModalityBinding[]>();
  private readonly abortControllers = new Map<AgentSessionId, AbortController>();
  private readonly store: AgentSessionStore;
  private readonly runtime: AgentRuntime;

  constructor(options: AgentSessionManagerOptions = {}) {
    this.store = options.store ?? new InMemoryAgentSessionStore();
    this.runtime = options.runtime ?? new MockAgentRuntime();
  }

  create(input: CreateAgentSessionInput): AgentSession {
    const now = new Date().toISOString();
    const modalityBindings = input.modalityBindings ?? [];
    const session: AgentSession = {
      id: createId<"AgentSessionId">("sess"),
      goal: input.goal,
      title: input.title,
      state: "idle",
      runtime: input.runtime ?? { provider: "mock", model: "mock-agent-runtime" },
      modalityBindingIds: modalityBindings.map((binding) => binding.id),
      modalityBindings,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata
    };

    this.sessions.set(session.id, session);
    this.bindings.set(session.id, modalityBindings);
    this.emit(session.id, { type: "session.created", goal: session.goal });
    for (const binding of modalityBindings) {
      this.emit(session.id, { type: "session.modality_bound", bindingId: binding.id, key: binding.key, modalityId: binding.id });
    }
    return this.copySession(session);
  }

  get(sessionId: AgentSessionId): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? this.copySession(session) : undefined;
  }

  list(): AgentSession[] {
    return [...this.sessions.values()].map((session) => this.copySession(session));
  }

  listBindings(sessionId: AgentSessionId): AgentSessionModalityBinding[] {
    this.requireSession(sessionId);
    return this.copyBindings(sessionId);
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
        session: this.copySession(this.requireSession(sessionId)),
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

  bindModality(sessionId: AgentSessionId, binding: AgentSessionModalityBinding): void {
    const session = this.requireSession(sessionId);
    const current = this.bindings.get(sessionId) ?? [];
    if (current.some((candidate) => candidate.id === binding.id)) return;
    const next = [...current, binding];
    this.bindings.set(sessionId, next);
    this.patch(sessionId, {
      modalityBindingIds: next.map((candidate) => candidate.id),
      modalityBindings: next
    });
    this.emit(sessionId, { type: "session.modality_bound", bindingId: binding.id, key: binding.key, modalityId: binding.id });
  }

  observe(
    sessionId: AgentSessionId,
    bindingId: AgentSessionModalityId,
    observationType: string,
    value: unknown,
    sourceTimestamp?: string
  ): AgentSessionEvent {
    this.requireBinding(sessionId, bindingId);
    return this.emit(sessionId, { type: "modality.observation", bindingId, modalityId: bindingId, observationType, value, sourceTimestamp });
  }

  act(sessionId: AgentSessionId, bindingId: AgentSessionModalityId, actionType: string, value: unknown): AgentSessionEvent {
    this.requireBinding(sessionId, bindingId);
    return this.emit(sessionId, { type: "modality.action", bindingId, modalityId: bindingId, actionType, value });
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

  private emit(sessionId: AgentSessionId, event: AgentSessionEventPayload): AgentSessionEvent {
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

  private requireBinding(sessionId: AgentSessionId, bindingId: AgentSessionModalityId): AgentSessionModalityBinding {
    const binding = (this.bindings.get(sessionId) ?? []).find((candidate) => candidate.id === bindingId);
    if (!binding) throw new Error(`Unknown modality binding for session ${sessionId}: ${bindingId}`);
    return binding;
  }

  private copySession(session: AgentSession): AgentSession {
    const bindings = this.copyBindings(session.id);
    return {
      ...session,
      modalityBindingIds: [...session.modalityBindingIds],
      modalityBindings: bindings
    };
  }

  private copyBindings(sessionId: AgentSessionId): AgentSessionModalityBinding[] {
    return (this.bindings.get(sessionId) ?? []).map((binding) => ({
      ...binding,
      capabilities: [...binding.capabilities]
    }));
  }
}
