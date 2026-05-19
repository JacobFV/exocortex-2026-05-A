import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("exocortex", {
  createSession: (goal: string, model?: string) => ipcRenderer.invoke("exocortex:create-session", goal, model),
  listSessions: () => ipcRenderer.invoke("exocortex:list-sessions"),
  listEvents: (sessionId: string) => ipcRenderer.invoke("exocortex:list-events", sessionId),
  listBindings: (sessionId: string) => ipcRenderer.invoke("exocortex:list-bindings", sessionId),
  listArtifacts: (sessionId: string) => ipcRenderer.invoke("exocortex:list-artifacts", sessionId),
  listModalities: () => ipcRenderer.invoke("exocortex:list-modalities"),
  injectAppText: (text: string) => ipcRenderer.invoke("exocortex:inject-app-text", text),
  sendModalityAction: (sessionId: string, bindingId: string, actionType: string, value: unknown) =>
    ipcRenderer.invoke("exocortex:send-modality-action", sessionId, bindingId, actionType, value),
  armActuator: (channel: string, reason: string) => ipcRenderer.invoke("exocortex:arm-actuator", channel, reason),
  listActuatorSafety: () => ipcRenderer.invoke("exocortex:list-actuator-safety"),
  createBrowserSession: () => ipcRenderer.invoke("exocortex:create-browser-session"),
  listBrowserSessions: () => ipcRenderer.invoke("exocortex:list-browser-sessions"),
  browserDispatch: (browserSessionId: string, action: unknown) => ipcRenderer.invoke("exocortex:browser-dispatch", browserSessionId, action),
  browserCapture: (browserSessionId: string) => ipcRenderer.invoke("exocortex:browser-capture", browserSessionId)
});
