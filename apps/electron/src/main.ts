import { app, BrowserWindow, ipcMain } from "electron";
import { BrowserSessionManager } from "@exocortex/browser-session";
import { ManualInputBridge, ModalityRegistry } from "@exocortex/peripherals";
import { AgentSessionManager } from "@exocortex/session";

const modalityRegistry = new ModalityRegistry();
const defaultModalities = modalityRegistry.registerDefaults();
const sessionManager = new AgentSessionManager();
const browserSessionManager = new BrowserSessionManager();

const appTextModality = modalityRegistry.getByKey("app_input_text") ?? defaultModalities[0];
const appTextBridge = new ManualInputBridge(appTextModality);

appTextBridge.subscribe((observation) => {
  for (const session of sessionManager.list().filter((candidate) => candidate.state === "running")) {
    sessionManager.observe(session.id, observation.modalityId, observation.observationType, observation.value);
  }
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

ipcMain.handle("exocortex:create-session", async (_event, goal: string) => {
  const session = sessionManager.create({
    goal,
    modalityIds: modalityRegistry.list().map((modality) => modality.id)
  });
  void sessionManager.start(session.id);
  return session;
});

ipcMain.handle("exocortex:list-sessions", () => sessionManager.list());
ipcMain.handle("exocortex:list-events", (_event, sessionId: string) => sessionManager.events(sessionId as never));
ipcMain.handle("exocortex:list-modalities", () => modalityRegistry.list());
ipcMain.handle("exocortex:inject-app-text", (_event, text: string) => appTextBridge.injectText(text));
ipcMain.handle("exocortex:create-browser-session", async () => {
  const browserModality = modalityRegistry.register({
    key: `browser_session_${Date.now()}`,
    label: "Browser session",
    direction: "duplex",
    kind: "browser",
    source: "browser_session",
    transport: "ipc",
    capabilities: ["browser.project_screen", "browser.input.pointer", "browser.input.keyboard", "browser.navigate"]
  });
  return browserSessionManager.create(browserModality.id);
});

app.whenReady().then(createMainWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

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
      .row { display: flex; gap: 8px; }
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
        <h2>Modalities</h2>
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
