import {
  createId,
  type BrowserAction,
  type BrowserProjectionFrame,
  type BrowserSession,
  type BrowserSessionId,
  type ModalityInstanceId
} from "@exocortex/protocol";

export interface BrowserController {
  start(session: BrowserSession): Promise<void>;
  stop(session: BrowserSession): Promise<void>;
  dispatch(session: BrowserSession, action: BrowserAction): Promise<void>;
  captureFrame?(session: BrowserSession): Promise<BrowserProjectionFrame | undefined>;
}

export class MemoryBrowserController implements BrowserController {
  readonly actions: Array<{ sessionId: BrowserSessionId; action: BrowserAction }> = [];

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async dispatch(session: BrowserSession, action: BrowserAction): Promise<void> {
    this.actions.push({ sessionId: session.id, action });
  }
}

export class BrowserSessionManager {
  private readonly sessions = new Map<BrowserSessionId, BrowserSession>();

  constructor(private readonly controller: BrowserController = new MemoryBrowserController()) {}

  async create(modalityInstanceId: ModalityInstanceId, metadata?: Record<string, unknown>): Promise<BrowserSession> {
    const now = new Date().toISOString();
    const session: BrowserSession = {
      id: createId<"BrowserSessionId">("browser"),
      modalityInstanceId,
      state: "created",
      createdAt: now,
      updatedAt: now,
      metadata
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async start(id: BrowserSessionId): Promise<BrowserSession> {
    const session = this.requireSession(id);
    const starting = this.patch(id, { state: "starting" });
    await this.controller.start(starting);
    return this.patch(id, { state: "running" });
  }

  async stop(id: BrowserSessionId): Promise<BrowserSession> {
    const session = this.requireSession(id);
    await this.controller.stop(session);
    return this.patch(id, { state: "stopped" });
  }

  async dispatch(id: BrowserSessionId, action: BrowserAction): Promise<void> {
    const session = this.requireSession(id);
    await this.controller.dispatch(session, action);
    if (action.type === "navigate") {
      this.patch(id, { currentUrl: action.url });
    }
  }

  async captureFrame(id: BrowserSessionId): Promise<BrowserProjectionFrame | undefined> {
    const session = this.requireSession(id);
    return this.controller.captureFrame?.(session);
  }

  list(): BrowserSession[] {
    return [...this.sessions.values()].map((session) => ({ ...session }));
  }

  private patch(id: BrowserSessionId, patch: Partial<BrowserSession>): BrowserSession {
    const session = this.requireSession(id);
    const next = { ...session, ...patch, updatedAt: new Date().toISOString() };
    this.sessions.set(id, next);
    return next;
  }

  private requireSession(id: BrowserSessionId): BrowserSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown browser session: ${id}`);
    return session;
  }
}
