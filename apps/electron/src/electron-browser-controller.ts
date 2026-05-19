import { BrowserWindow } from "electron";
import type { BrowserAction, BrowserProjectionFrame, BrowserSession } from "@exocortex/protocol";
import type { BrowserController } from "@exocortex/browser-session";

export class ElectronBrowserController implements BrowserController {
  private readonly windows = new Map<string, BrowserWindow>();

  async start(session: BrowserSession): Promise<void> {
    if (this.windows.has(session.id)) return;
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        offscreen: true
      }
    });
    this.windows.set(session.id, win);
    await win.loadURL(session.currentUrl ?? "about:blank");
  }

  async stop(session: BrowserSession): Promise<void> {
    const win = this.requireWindow(session);
    this.windows.delete(session.id);
    if (!win.isDestroyed()) win.close();
  }

  async dispatch(session: BrowserSession, action: BrowserAction): Promise<void> {
    const win = this.requireWindow(session);
    const webContents = win.webContents;
    switch (action.type) {
      case "navigate":
        await win.loadURL(action.url);
        return;
      case "click":
        webContents.sendInputEvent({ type: "mouseDown", x: Math.round(action.x), y: Math.round(action.y), button: action.button ?? "left", clickCount: 1 });
        webContents.sendInputEvent({ type: "mouseUp", x: Math.round(action.x), y: Math.round(action.y), button: action.button ?? "left", clickCount: 1 });
        return;
      case "type":
        webContents.insertText(action.text);
        return;
      case "key":
        webContents.sendInputEvent({
          type: "keyDown",
          keyCode: action.key,
          modifiers: action.modifiers?.map((modifier) => modifier.toLowerCase() as "alt" | "control" | "meta" | "shift")
        });
        webContents.sendInputEvent({ type: "keyUp", keyCode: action.key });
        return;
      case "scroll":
        webContents.sendInputEvent({
          type: "mouseWheel",
          x: Math.round(action.x ?? 640),
          y: Math.round(action.y ?? 400),
          deltaX: action.deltaX ?? 0,
          deltaY: action.deltaY ?? 0
        });
        return;
      case "touch":
        for (const point of action.points) {
          webContents.sendInputEvent({
            type: action.phase === "end" || action.phase === "cancel" ? "mouseUp" : "mouseMove",
            x: Math.round(point.x),
            y: Math.round(point.y),
            button: "left"
          });
        }
        return;
      case "evaluate":
        await webContents.executeJavaScript(action.expression, true);
        return;
    }
  }

  async captureFrame(session: BrowserSession): Promise<BrowserProjectionFrame> {
    const win = this.requireWindow(session);
    const image = await win.webContents.capturePage();
    return {
      browserSessionId: session.id,
      modalityInstanceId: session.modalityInstanceId,
      width: image.getSize().width,
      height: image.getSize().height,
      mimeType: "image/png",
      data: image.toDataURL(),
      capturedAt: new Date().toISOString()
    };
  }

  private requireWindow(session: BrowserSession): BrowserWindow {
    const win = this.windows.get(session.id);
    if (!win || win.isDestroyed()) throw new Error(`Browser window is not running for session ${session.id}`);
    return win;
  }
}
