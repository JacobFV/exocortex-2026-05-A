import { app, BrowserWindow, ipcMain } from "electron";
import { BrowserSessionManager } from "@exocortex/browser-session";
import { defaultHeadBridgeConfig } from "@exocortex/hardware";
import type { AgentSessionId, AgentSessionModalityId, BrowserAction, BrowserSessionId } from "@exocortex/protocol";
import { HeadBridgeSerialSource, ManualInputBridge, ModalityRegistry } from "@exocortex/peripherals";
import { AgentSessionManager, ModalityActionRouter, ModalityObservationRouter } from "@exocortex/session";
import { ElectronBrowserController } from "./electron-browser-controller.js";

const modalityRegistry = new ModalityRegistry();
const hostModalities = modalityRegistry.createDefaultHostGraph();
const sessionManager = new AgentSessionManager();
const observationRouter = new ModalityObservationRouter(sessionManager);
const actionRouter = new ModalityActionRouter(sessionManager);
const browserSessionManager = new BrowserSessionManager(new ElectronBrowserController());

const appTextModality = modalityRegistry.getModalityByKey("app_input_text") ?? hostModalities[0];
const appTextBridge = new ManualInputBridge(appTextModality);
observationRouter.attachBridge(appTextBridge);

const headBridgeModalities = modalityRegistry.createHeadBridgeGraph(defaultHeadBridgeConfig());
const headBridgeSerialPath = process.env.EXOCORTEX_HEAD_BRIDGE_SERIAL;
let headBridgeSource: HeadBridgeSerialSource | undefined;
if (headBridgeSerialPath) {
  headBridgeSource = new HeadBridgeSerialSource(
    headBridgeModalities.filter((modality) => modality.direction === "input"),
    {
      path: headBridgeSerialPath,
      baudRate: Number(process.env.EXOCORTEX_HEAD_BRIDGE_BAUD ?? 115200)
    }
  );
  observationRouter.attachObservationSource(
    "head_bridge_serial_source",
    headBridgeSource
  );
  for (const modality of headBridgeModalities.filter((candidate) => candidate.direction === "output")) {
    actionRouter.registerSink(modality.id, {
      send: (actionType, value) => headBridgeSource!.send(modality.key, actionType, value)
    });
  }
}
actionRouter.start();

void observationRouter.startAll().catch((error) => {
  console.error("Failed to start modality bridges", error);
});

async function createMainWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Exocortex",
    webPreferences: {
      preload: new URL("./preload.js", import.meta.url).pathname,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderHtml())}`);
}

ipcMain.handle("exocortex:create-session", async (_event, goal: string, model = process.env.EXOCORTEX_MODEL ?? "local-rules") => {
  const session = sessionManager.create({ goal, runtime: { provider: "local", model, driver: "model-driven-agent-runtime" } });
  for (const modality of modalityRegistry.listModalityInstances()) {
    sessionManager.bindModality(session.id, registryBinding(session.id, modality.id));
  }
  observationRouter.bindSession(session.id, sessionManager.listBindings(session.id));
  actionRouter.bindSession(sessionManager.listBindings(session.id));
  void sessionManager.start(session.id);
  return sessionManager.get(session.id);
});

ipcMain.handle("exocortex:list-sessions", () => sessionManager.list());
ipcMain.handle("exocortex:list-events", (_event, sessionId: AgentSessionId) => sessionManager.events(sessionId));
ipcMain.handle("exocortex:list-bindings", (_event, sessionId: AgentSessionId) => sessionManager.listBindings(sessionId));
ipcMain.handle("exocortex:list-artifacts", (_event, sessionId: AgentSessionId) => sessionManager.artifacts(sessionId));
ipcMain.handle("exocortex:list-modalities", () => ({
  deviceTypes: modalityRegistry.listDeviceTypes(),
  modalityTypes: modalityRegistry.listModalityTypes(),
  devices: modalityRegistry.listDeviceInstances(),
  modalities: modalityRegistry.listModalityInstances()
}));
ipcMain.handle("exocortex:inject-app-text", (_event, text: string) => appTextBridge.injectText(text));
ipcMain.handle("exocortex:send-modality-action", (_event, sessionId: AgentSessionId, bindingId: AgentSessionModalityId, actionType: string, value: unknown) =>
  sessionManager.act(sessionId, bindingId, actionType, value)
);
ipcMain.handle("exocortex:create-browser-session", async () => {
  const device = modalityRegistry.createDeviceInstance({
    typeKey: "browser_session",
    key: `browser_${Date.now()}`,
    label: "Browser session",
    transport: "ipc"
  });
  const projectedScreen = modalityRegistry.createModalityInstance({
    typeKey: "browser_projected_screen",
    deviceId: device.id,
    source: "browser_session",
    transport: "ipc"
  });
  modalityRegistry.createModalityInstance({
    typeKey: "browser_control_input",
    deviceId: device.id,
    source: "browser_session",
    transport: "ipc"
  });
  const browser = await browserSessionManager.create(projectedScreen.id);
  await browserSessionManager.start(browser.id);
  return browserSessionManager.captureFrame(browser.id);
});
ipcMain.handle("exocortex:list-browser-sessions", () => browserSessionManager.list());
ipcMain.handle("exocortex:browser-dispatch", (_event, browserSessionId: BrowserSessionId, action: BrowserAction) =>
  browserSessionManager.dispatch(browserSessionId, action)
);
ipcMain.handle("exocortex:browser-capture", (_event, browserSessionId: BrowserSessionId) =>
  browserSessionManager.captureFrame(browserSessionId)
);

app.whenReady().then(createMainWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  actionRouter.stop();
  void observationRouter.stopAll();
});

function registryBinding(sessionId: Parameters<AgentSessionManager["listBindings"]>[0], modalityInstanceId: Parameters<ModalityRegistry["bindToSession"]>[0]["modalityInstanceId"]) {
  return modalityRegistry.bindToSession({ sessionId, modalityInstanceId });
}

function renderHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Exocortex</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #101418; color: #eef2f4; }
      main { display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }
      aside { border-right: 1px solid #2b333a; padding: 16px; }
      section { padding: 16px; }
      input, textarea, button { font: inherit; }
      textarea { width: 100%; min-height: 96px; box-sizing: border-box; }
      button { margin-top: 8px; padding: 8px 10px; }
      pre { white-space: pre-wrap; background: #171d22; padding: 12px; border: 1px solid #2b333a; }
    </style>
  </head>
  <body>
    <main>
      <aside>
        <h1>Exocortex</h1>
        <textarea id="goal">Understand current wearable context and keep modalities separated.</textarea>
        <button id="start">Start agent session</button>
        <h2>Input</h2>
        <input id="text" placeholder="app_input_text" />
        <button id="send">Inject text</button>
        <h2>Sessions</h2>
        <pre id="sessions"></pre>
      </aside>
      <section>
        <h2>Events</h2>
        <pre id="events"></pre>
        <h2>Device and Modality Graph</h2>
        <pre id="modalities"></pre>
      </section>
    </main>
    <script>
      const sessionsEl = document.querySelector("#sessions");
      const eventsEl = document.querySelector("#events");
      const modalitiesEl = document.querySelector("#modalities");
      let selectedSessionId;
      async function refresh() {
        const sessions = await window.exocortex.listSessions();
        selectedSessionId = selectedSessionId || sessions[0]?.id;
        sessionsEl.textContent = JSON.stringify(sessions, null, 2);
        modalitiesEl.textContent = JSON.stringify(await window.exocortex.listModalities(), null, 2);
        eventsEl.textContent = selectedSessionId
          ? JSON.stringify(await window.exocortex.listEvents(selectedSessionId), null, 2)
          : "No session";
      }
      document.querySelector("#start").addEventListener("click", async () => {
        const session = await window.exocortex.createSession(document.querySelector("#goal").value);
        selectedSessionId = session.id;
        setTimeout(refresh, 100);
      });
      document.querySelector("#send").addEventListener("click", async () => {
        await window.exocortex.injectAppText(document.querySelector("#text").value);
        await refresh();
      });
      setInterval(refresh, 1000);
      refresh();
    </script>
  </body>
</html>`;
}
