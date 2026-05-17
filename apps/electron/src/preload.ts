import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("exocortex", {
  createSession: (goal: string) => ipcRenderer.invoke("exocortex:create-session", goal),
  listSessions: () => ipcRenderer.invoke("exocortex:list-sessions"),
  listEvents: (sessionId: string) => ipcRenderer.invoke("exocortex:list-events", sessionId),
  listModalities: () => ipcRenderer.invoke("exocortex:list-modalities"),
  injectAppText: (text: string) => ipcRenderer.invoke("exocortex:inject-app-text", text),
  createBrowserSession: () => ipcRenderer.invoke("exocortex:create-browser-session")
});
