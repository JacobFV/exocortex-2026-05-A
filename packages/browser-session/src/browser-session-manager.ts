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

export class SyntheticBrowserController implements BrowserController {
  private readonly actionLog = new Map<BrowserSessionId, BrowserAction[]>();

  async start(session: BrowserSession): Promise<void> {
    this.actionLog.set(session.id, []);
  }

  async stop(session: BrowserSession): Promise<void> {
    this.actionLog.delete(session.id);
  }

  async dispatch(session: BrowserSession, action: BrowserAction): Promise<void> {
    const actions = this.actionLog.get(session.id) ?? [];
    actions.push(action);
    this.actionLog.set(session.id, actions);
  }

  async captureFrame(session: BrowserSession): Promise<BrowserProjectionFrame> {
    const actions = this.actionLog.get(session.id) ?? [];
    const lastAction = actions.at(-1);
    const label = lastAction ? JSON.stringify(lastAction) : "browser session ready";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800">
<rect width="1280" height="800" fill="#101418"/>
<text x="40" y="80" fill="#eef2f4" font-family="monospace" font-size="28">Exocortex Browser Projection</text>
<text x="40" y="140" fill="#9fb0bc" font-family="monospace" font-size="18">${escapeXml(session.currentUrl ?? "about:blank")}</text>
<text x="40" y="200" fill="#c8d3da" font-family="monospace" font-size="16">${escapeXml(label).slice(0, 200)}</text>
</svg>`;
    return {
      browserSessionId: session.id,
      modalityInstanceId: session.modalityInstanceId,
      width: 1280,
      height: 800,
      mimeType: "image/svg+xml",
      data: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      capturedAt: new Date().toISOString()
    };
  }
}

export class BrowserSessionManager {
  private readonly sessions = new Map<BrowserSessionId, BrowserSession>();
  private readonly listeners = new Set<BrowserSessionEventListener>();

  constructor(private readonly controller: BrowserController = new SyntheticBrowserController()) {}

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

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });
}
