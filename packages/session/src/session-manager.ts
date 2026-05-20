import {
  MAIN_RUN_ID,
  type EventGraphKernel
} from "@exocortex/continuity";
import {
  createId,
  type AgentRuntimeRef,
  type AgentSession,
  type AgentSessionArtifact,
  type AgentSessionEvent,
  type AgentSessionEventPayload,
  type AgentSessionId,
  type AgentSessionModalityBinding,
  type AgentSessionModalityId,
  type AgentSessionState,
  type BrowserAction,
  type BrowserProjectionFrame,
  type BrowserSessionId
} from "@exocortex/protocol";
import type { ModalityBindingPolicy } from "@exocortex/protocol";
import type { AgentRuntime } from "./agent-runtime.js";
import { ModelDrivenAgentRuntime } from "./agent-runtime.js";
import type { AgentSessionEventListener, AgentSessionStore } from "./event-store.js";
import { AgentSessionEventBus, InMemoryAgentSessionStore } from "./event-store.js";

export interface CreateAgentSessionInput {
  goal: string;
  title?: string;
  runtime?: AgentRuntimeRef;
  continuityRunId?: string;
  modalityBindings?: AgentSessionModalityBinding[];
  metadata?: Record<string, unknown>;
}

export interface AgentSessionManagerOptions {
  store?: AgentSessionStore;
  runtime?: AgentRuntime;
  eventGraphKernel?: EventGraphKernel;
}

export class AgentSessionManager {
  private readonly sessions = new Map<AgentSessionId, AgentSession>();
  private readonly bindings = new Map<AgentSessionId, AgentSessionModalityBinding[]>();
  private readonly abortControllers = new Map<AgentSessionId, AbortController>();
  private readonly runtimeTasks = new Map<AgentSessionId, Promise<void>>();
  private readonly store: AgentSessionStore;
  private readonly bus = new AgentSessionEventBus();
  private readonly runtime: AgentRuntime;
  private readonly eventGraphKernel?: EventGraphKernel;

  constructor(options: AgentSessionManagerOptions = {}) {
    this.store = options.store ?? new InMemoryAgentSessionStore();
    this.runtime = options.runtime ?? new ModelDrivenAgentRuntime();
    this.eventGraphKernel = options.eventGraphKernel;
    this.restorePersistedSessions();
  }

  create(input: CreateAgentSessionInput): AgentSession {
    const now = new Date().toISOString();
    const modalityBindings = input.modalityBindings ?? [];
    const session: AgentSession = {
      id: createId<"AgentSessionId">("sess"),
      continuityRunId: input.continuityRunId ?? MAIN_RUN_ID,
      goal: input.goal,
      title: input.title,
      state: "idle",
      runtime: input.runtime ?? { provider: "local", model: "local-rules", driver: this.runtime.runtimeId },
      modalityBindingIds: modalityBindings.map((binding) => binding.id),
      modalityBindings,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata
    };

    this.sessions.set(session.id, session);
    this.bindings.set(session.id, modalityBindings);
    this.emit(session.id, { type: "session.created", goal: session.goal, runtime: session.runtime });
    for (const binding of modalityBindings) {
      this.emit(session.id, { type: "session.modality_bound", bindingId: binding.id, key: binding.key, modalityId: binding.id, metadata: { binding } });
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
    if (session.state === "running" || session.state === "starting") return;

    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);
    this.transition(sessionId, "starting");
    this.patch(sessionId, { startedAt: new Date().toISOString() });
    this.transition(sessionId, "running");

    const task = this.runtime
      .start(this.runtimeContext(sessionId, controller))
      .then(() => {
        this.abortControllers.delete(sessionId);
        this.runtimeTasks.delete(sessionId);
        const current = this.sessions.get(sessionId);
        if (current && current.state !== "stopped" && current.state !== "finished" && current.state !== "error") {
          this.finish(sessionId, true, "Agent runtime completed.");
        }
      })
      .catch((error) => {
        this.abortControllers.delete(sessionId);
        this.runtimeTasks.delete(sessionId);
        const message = error instanceof Error ? error.message : "Unknown agent runtime error";
        this.fail(sessionId, "agent_runtime_error", message, true);
      });
    this.runtimeTasks.set(sessionId, task);
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
    this.emit(sessionId, { type: "session.modality_bound", bindingId: binding.id, key: binding.key, modalityId: binding.id, metadata: { binding } });
  }

  updateModalityBindingPolicy(sessionId: AgentSessionId, bindingId: AgentSessionModalityId, nextPolicy: ModalityBindingPolicy): AgentSessionModalityBinding {
    this.requireSession(sessionId);
    const current = this.bindings.get(sessionId) ?? [];
    const index = current.findIndex((candidate) => candidate.id === bindingId);
    if (index < 0) throw new Error(`Unknown modality binding for session ${sessionId}: ${bindingId}`);
    const previous = current[index]!;
    if (previous.policy === nextPolicy) return { ...previous, capabilities: [...previous.capabilities] };
    const next = current.map((binding, candidateIndex) =>
      candidateIndex === index ? { ...binding, policy: nextPolicy, metadata: { ...(binding.metadata ?? {}), policyUpdatedAt: new Date().toISOString() } } : binding
    );
    this.bindings.set(sessionId, next);
    this.patch(sessionId, {
      modalityBindings: next,
      modalityBindingIds: next.map((candidate) => candidate.id)
    });
    const updated = next[index]!;
    this.emit(sessionId, {
      type: "session.modality_policy_changed",
      bindingId,
      modalityId: bindingId,
      key: updated.key,
      previousPolicy: previous.policy,
      nextPolicy,
      metadata: { binding: updated }
    });
    return { ...updated, capabilities: [...updated.capabilities] };
  }

  observe(
    sessionId: AgentSessionId,
    bindingId: AgentSessionModalityId,
    observationType: string,
    value: unknown,
    sourceTimestamp?: string
  ): AgentSessionEvent {
    this.requireBinding(sessionId, bindingId);
    const event = this.emit(sessionId, { type: "modality.observation", bindingId, modalityId: bindingId, observationType, value, sourceTimestamp });
    this.deliverObservation(sessionId, event);
    return event;
  }

  act(sessionId: AgentSessionId, bindingId: AgentSessionModalityId, actionType: string, value: unknown): AgentSessionEvent {
    this.requireBinding(sessionId, bindingId);
    return this.emit(sessionId, { type: "modality.action", bindingId, modalityId: bindingId, actionType, value });
  }

  recordBrowserCreated(sessionId: AgentSessionId, browserSessionId: BrowserSessionId): AgentSessionEvent {
    this.requireSession(sessionId);
    return this.emit(sessionId, { type: "browser.created", browserSessionId });
  }

  recordBrowserAction(sessionId: AgentSessionId, browserSessionId: BrowserSessionId, action: BrowserAction): AgentSessionEvent {
    this.requireSession(sessionId);
    return this.emit(sessionId, { type: "browser.action", browserSessionId, action });
  }

  recordBrowserProjectionFrame(sessionId: AgentSessionId, frame: BrowserProjectionFrame): AgentSessionEvent {
    this.requireSession(sessionId);
    return this.emit(sessionId, { type: "browser.projection_frame", frame });
  }

  recordSessionError(sessionId: AgentSessionId, code: string, message: string, recoverable = true, modalityId?: AgentSessionModalityId): AgentSessionEvent {
    this.requireSession(sessionId);
    return this.emit(sessionId, { type: "session.error", code, message, recoverable, modalityId });
  }

  events(sessionId: AgentSessionId): AgentSessionEvent[] {
    this.requireSession(sessionId);
    return this.store.listEvents(sessionId);
  }

  createArtifact(input: Omit<AgentSessionArtifact, "id" | "createdAt"> & { id?: AgentSessionArtifact["id"]; createdAt?: string }): AgentSessionArtifact {
    this.requireSession(input.sessionId);
    const artifact: AgentSessionArtifact = {
      ...input,
      id: input.id ?? createId<"AgentSessionArtifactId">("art"),
      createdAt: input.createdAt ?? new Date().toISOString()
    };
    this.store.putArtifact(artifact);
    this.emit(input.sessionId, { type: "artifact.created", artifactId: artifact.id, artifact });
    return artifact;
  }

  artifacts(sessionId: AgentSessionId): AgentSessionArtifact[] {
    this.requireSession(sessionId);
    return this.store.listArtifacts(sessionId);
  }

  subscribe(sessionId: AgentSessionId | "*", listener: AgentSessionEventListener): () => void {
    return this.bus.subscribe(sessionId, listener);
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
    this.eventGraphKernel?.appendSessionEvent(fullEvent);
    this.bus.publish(fullEvent);
    return fullEvent;
  }

  private runtimeContext(sessionId: AgentSessionId, controller?: AbortController) {
    const signal = controller?.signal ?? this.abortControllers.get(sessionId)?.signal;
    if (!signal) throw new Error(`Agent session is not running: ${sessionId}`);
    return {
      session: this.copySession(this.requireSession(sessionId)),
      signal,
      emit: (event: AgentSessionEventPayload) => this.emit(sessionId, event)
    };
  }

  private deliverObservation(sessionId: AgentSessionId, event: AgentSessionEvent): void {
    const controller = this.abortControllers.get(sessionId);
    if (!controller || !this.runtime.handleObservation) return;
    void this.runtime.handleObservation(this.runtimeContext(sessionId, controller), event).catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown observation handling error";
      this.emit(sessionId, { type: "session.error", code: "observation_handler_error", message, recoverable: true });
    });
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
      capabilities: [...binding.capabilities],
      metadata: binding.metadata ? { ...binding.metadata } : undefined
    }));
  }

  private restorePersistedSessions(): void {
    for (const sessionId of this.store.listSessionIds()) {
      const events = this.store.listEvents(sessionId);
      const created = events.find((event): event is Extract<AgentSessionEvent, { type: "session.created" }> => event.type === "session.created");
      if (!created) continue;

      const bindings = events
        .filter((event): event is Extract<AgentSessionEvent, { type: "session.modality_bound" }> => event.type === "session.modality_bound")
        .map((event) => persistedBindingFromEvent(event))
        .filter((binding): binding is AgentSessionModalityBinding => Boolean(binding));
      const lastEvent = events.at(-1) ?? created;
      const lastStateChange = [...events].reverse().find((event): event is Extract<AgentSessionEvent, { type: "session.state_changed" }> => event.type === "session.state_changed");
      const error = [...events].reverse().find((event): event is Extract<AgentSessionEvent, { type: "session.error" }> => event.type === "session.error");
      const finished = [...events].reverse().find((event): event is Extract<AgentSessionEvent, { type: "session.finished" }> => event.type === "session.finished");
      const started = events.find((event) => event.type === "session.state_changed" && (event.nextState === "starting" || event.nextState === "running"));
      const restoredState = persistedRuntimeState(lastStateChange?.nextState ?? "idle");
      const session: AgentSession = {
        id: sessionId,
        continuityRunId: "main",
        goal: created.goal,
        state: restoredState,
        runtime: created.runtime ?? { provider: "local", model: "local-rules", driver: this.runtime.runtimeId },
        modalityBindingIds: bindings.map((binding) => binding.id),
        modalityBindings: bindings,
        createdAt: created.createdAt,
        updatedAt: lastEvent.createdAt,
        startedAt: started?.createdAt,
        finishedAt: finished || error || restoredState === "stopped" ? lastEvent.createdAt : undefined,
        error: error ? { code: error.code, message: error.message, recoverable: error.recoverable } : undefined,
        metadata: { restoredFromEvents: true }
      };
      this.sessions.set(sessionId, session);
      this.bindings.set(sessionId, bindings);
    }
  }
}

function persistedBindingFromEvent(event: Extract<AgentSessionEvent, { type: "session.modality_bound" }>): AgentSessionModalityBinding | undefined {
  const binding = event.metadata?.binding;
  if (isPersistedBinding(binding)) return binding;
  return undefined;
}

function isPersistedBinding(value: unknown): value is AgentSessionModalityBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AgentSessionModalityBinding>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.modalityInstanceId === "string" &&
    typeof candidate.key === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.direction === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.policy === "string" &&
    typeof candidate.source === "string" &&
    Array.isArray(candidate.capabilities) &&
    typeof candidate.boundAt === "string"
  );
}

function persistedRuntimeState(state: AgentSessionState): AgentSessionState {
  if (state === "finished" || state === "stopped" || state === "error" || state === "idle" || state === "paused") return state;
  return "stopped";
}
