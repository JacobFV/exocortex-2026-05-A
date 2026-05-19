import {
  createId,
  type BrowserAction,
  type BrowserProjectionFrame,
  type BrowserSession,
  type BrowserSessionId,
  type BrowserSessionState,
  type ModalityInstanceId
} from "@exocortex/protocol";

export type BrowserSessionEvent =
  | { type: "created"; session: BrowserSession }
  | { type: "state_changed"; session: BrowserSession; previousState: BrowserSessionState }
  | { type: "action"; session: BrowserSession; action: BrowserAction }
  | { type: "projection_frame"; session: BrowserSession; frame: BrowserProjectionFrame };

export type BrowserSessionEventListener = (event: BrowserSessionEvent) => void;

export interface BrowserController {
  start(session: BrowserSession): Promise<void>;
  stop(session: BrowserSession): Promise<void>;
  dispatch(session: BrowserSession, action: BrowserAction): Promise<void>;
  captureFrame(session: BrowserSession): Promise<BrowserProjectionFrame | undefined>;
}

export class BrowserSessionManager {
  private readonly sessions = new Map<BrowserSessionId, BrowserSession>();
  private readonly listeners = new Set<BrowserSessionEventListener>();

  constructor(private readonly controller: BrowserController) {}

  async create(modalityInstanceId: ModalityInstanceId, metadata?: Record<string, unknown>): Promise<BrowserSession> {
    const now = new Date().toISOString();
    const session: BrowserSession = {
      id: createId<"BrowserSessionId">("browser"),
      modalityInstanceId,
      state: "created",
      currentUrl: "about:blank",
      createdAt: now,
      updatedAt: now,
      metadata
    };
    this.sessions.set(session.id, session);
    this.publish({ type: "created", session });
    return session;
  }

  async start(id: BrowserSessionId): Promise<BrowserSession> {
    const starting = this.transition(id, "starting");
    await this.controller.start(starting);
    return this.transition(id, "running");
  }

  async stop(id: BrowserSessionId): Promise<BrowserSession> {
    const session = this.requireSession(id);
    await this.controller.stop(session);
    return this.transition(id, "stopped");
  }

  async dispatch(id: BrowserSessionId, action: BrowserAction): Promise<BrowserProjectionFrame | undefined> {
    const session = this.requireSession(id);
    await this.controller.dispatch(session, action);
    let next = session;
    if (action.type === "navigate") {
      next = this.patch(id, { currentUrl: action.url });
    }
    this.publish({ type: "action", session: next, action });
    return this.captureFrame(id);
  }

  async captureFrame(id: BrowserSessionId): Promise<BrowserProjectionFrame | undefined> {
    const session = this.requireSession(id);
    const frame = await this.controller.captureFrame(session);
    if (frame) this.publish({ type: "projection_frame", session, frame });
    return frame;
  }

  subscribe(listener: BrowserSessionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): BrowserSession[] {
    return [...this.sessions.values()].map((session) => ({ ...session }));
  }

  private transition(id: BrowserSessionId, state: BrowserSessionState): BrowserSession {
    const previous = this.requireSession(id);
    const next = this.patch(id, { state });
    this.publish({ type: "state_changed", session: next, previousState: previous.state });
    return next;
  }

  private patch(id: BrowserSessionId, patch: Partial<BrowserSession>): BrowserSession {
    const session = this.requireSession(id);
    const next = { ...session, ...patch, updatedAt: new Date().toISOString() };
    this.sessions.set(id, next);
    return next;
  }

  private publish(event: BrowserSessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private requireSession(id: BrowserSessionId): BrowserSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown browser session: ${id}`);
    return session;
  }
}
