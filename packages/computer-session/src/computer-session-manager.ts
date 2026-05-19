import {
  createId,
  type ComputerAction,
  type ComputerProjectionFrame,
  type ComputerSession,
  type ComputerSessionId,
  type ComputerSessionState,
  type ModalityInstanceId
} from "@exocortex/protocol";

export type ComputerSessionEvent =
  | { type: "created"; session: ComputerSession }
  | { type: "state_changed"; session: ComputerSession; previousState: ComputerSessionState }
  | { type: "action"; session: ComputerSession; action: ComputerAction }
  | { type: "projection_frame"; session: ComputerSession; frame: ComputerProjectionFrame };

export type ComputerSessionEventListener = (event: ComputerSessionEvent) => void;

export interface ComputerController {
  start(session: ComputerSession): Promise<void>;
  stop(session: ComputerSession): Promise<void>;
  dispatch(session: ComputerSession, action: ComputerAction): Promise<void>;
  captureFrame(session: ComputerSession): Promise<ComputerProjectionFrame | undefined>;
}

export class ComputerSessionManager {
  private readonly sessions = new Map<ComputerSessionId, ComputerSession>();
  private readonly listeners = new Set<ComputerSessionEventListener>();

  constructor(private readonly controller: ComputerController) {}

  async create(modalityInstanceId: ModalityInstanceId, metadata?: Record<string, unknown>): Promise<ComputerSession> {
    const now = new Date().toISOString();
    const session: ComputerSession = {
      id: createId<"ComputerSessionId">("computer"),
      modalityInstanceId,
      state: "created",
      createdAt: now,
      updatedAt: now,
      metadata
    };
    this.sessions.set(session.id, session);
    this.publish({ type: "created", session });
    return session;
  }

  async start(id: ComputerSessionId): Promise<ComputerSession> {
    const starting = this.transition(id, "starting");
    await this.controller.start(starting);
    return this.transition(id, "running");
  }

  async stop(id: ComputerSessionId): Promise<ComputerSession> {
    const session = this.requireSession(id);
    await this.controller.stop(session);
    return this.transition(id, "stopped");
  }

  async dispatch(id: ComputerSessionId, action: ComputerAction): Promise<ComputerProjectionFrame | undefined> {
    const session = this.requireSession(id);
    await this.controller.dispatch(session, action);
    this.publish({ type: "action", session, action });
    return this.captureFrame(id);
  }

  async captureFrame(id: ComputerSessionId): Promise<ComputerProjectionFrame | undefined> {
    const session = this.requireSession(id);
    const frame = await this.controller.captureFrame(session);
    if (frame) this.publish({ type: "projection_frame", session, frame });
    return frame;
  }

  subscribe(listener: ComputerSessionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): ComputerSession[] {
    return [...this.sessions.values()].map((session) => ({ ...session }));
  }

  private transition(id: ComputerSessionId, state: ComputerSessionState): ComputerSession {
    const previous = this.requireSession(id);
    const next = this.patch(id, { state });
    this.publish({ type: "state_changed", session: next, previousState: previous.state });
    return next;
  }

  private patch(id: ComputerSessionId, patch: Partial<ComputerSession>): ComputerSession {
    const session = this.requireSession(id);
    const next = { ...session, ...patch, updatedAt: new Date().toISOString() };
    this.sessions.set(id, next);
    return next;
  }

  private publish(event: ComputerSessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private requireSession(id: ComputerSessionId): ComputerSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown computer session: ${id}`);
    return session;
  }
}
