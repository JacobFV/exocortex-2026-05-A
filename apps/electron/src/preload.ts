import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("exocortex", {
  createSession: (goal: string, model?: string) => ipcRenderer.invoke("exocortex:create-session", goal, model),
  listSessions: () => ipcRenderer.invoke("exocortex:list-sessions"),
  listEvents: (sessionId: string) => ipcRenderer.invoke("exocortex:list-events", sessionId),
  listBindings: (sessionId: string) => ipcRenderer.invoke("exocortex:list-bindings", sessionId),
  listArtifacts: (sessionId: string) => ipcRenderer.invoke("exocortex:list-artifacts", sessionId),
  listModalities: () => ipcRenderer.invoke("exocortex:list-modalities"),
  injectAppText: (text: string) => ipcRenderer.invoke("exocortex:inject-app-text", text),
  createBrowserSession: () => ipcRenderer.invoke("exocortex:create-browser-session"),
  listBrowserSessions: () => ipcRenderer.invoke("exocortex:list-browser-sessions"),
  browserDispatch: (browserSessionId: string, action: unknown) => ipcRenderer.invoke("exocortex:browser-dispatch", browserSessionId, action),
  browserCapture: (browserSessionId: string) => ipcRenderer.invoke("exocortex:browser-capture", browserSessionId)
});
