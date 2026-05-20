import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("exocortex", {
  createSession: (goal: string, model?: string) => ipcRenderer.invoke("exocortex:create-session", goal, model),
  stopSession: (sessionId: string) => ipcRenderer.invoke("exocortex:stop-session", sessionId),
  listSessions: () => ipcRenderer.invoke("exocortex:list-sessions"),
  listEvents: (sessionId: string) => ipcRenderer.invoke("exocortex:list-events", sessionId),
  listBindings: (sessionId: string) => ipcRenderer.invoke("exocortex:list-bindings", sessionId),
  listArtifacts: (sessionId: string) => ipcRenderer.invoke("exocortex:list-artifacts", sessionId),
  listModels: () => ipcRenderer.invoke("exocortex:list-models"),
  listModalities: () => ipcRenderer.invoke("exocortex:list-modalities"),
  listContinuityObjects: () => ipcRenderer.invoke("exocortex:list-continuity-objects"),
  listContinuityRelations: () => ipcRenderer.invoke("exocortex:list-continuity-relations"),
  listContinuityEvents: () => ipcRenderer.invoke("exocortex:list-continuity-events"),
  injectAppText: (text: string) => ipcRenderer.invoke("exocortex:inject-app-text", text),
  sendModalityAction: (sessionId: string, bindingId: string, actionType: string, value: unknown) =>
    ipcRenderer.invoke("exocortex:send-modality-action", sessionId, bindingId, actionType, value),
  armActuator: (channel: string, reason: string) => ipcRenderer.invoke("exocortex:arm-actuator", channel, reason),
  listActuatorSafety: () => ipcRenderer.invoke("exocortex:list-actuator-safety"),
  createBrowserSession: (sessionId?: string) => ipcRenderer.invoke("exocortex:create-browser-session", sessionId),
  listBrowserSessions: () => ipcRenderer.invoke("exocortex:list-browser-sessions"),
  browserDispatch: (browserSessionId: string, action: unknown, sessionId?: string) => ipcRenderer.invoke("exocortex:browser-dispatch", browserSessionId, action, sessionId),
  browserCapture: (browserSessionId: string, sessionId?: string) => ipcRenderer.invoke("exocortex:browser-capture", browserSessionId, sessionId),
  onSessionEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on("exocortex:session-event", wrapped);
    return () => ipcRenderer.off("exocortex:session-event", wrapped);
  },
  onContinuityEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on("exocortex:continuity-event", wrapped);
    return () => ipcRenderer.off("exocortex:continuity-event", wrapped);
  },
  onBrowserEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on("exocortex:browser-event", wrapped);
    return () => ipcRenderer.off("exocortex:browser-event", wrapped);
  }
});
