import { app, BrowserWindow, ipcMain } from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { BrowserSessionManager } from "@exocortex/browser-session";
import { type GraphObject, acceptCalibrationProfile, acceptSafetyGrant, acceptSafetyPolicy, assembleGraphContext, createDefaultContinuityBehaviors, createDefaultContinuityRelationBehaviors, EventGraphCapabilityRegistry, EventGraphKernel, EventSourcedGraph, listActiveCalibrationProfiles, listActiveSafetyGrants, listSafetyDenials, recordSafetyDenial, renderGraphContextForPrompt, SQLiteEventSourcedGraphStore } from "@exocortex/continuity";
import { type CalibrationProfile, validateCalibrationProfile } from "@exocortex/calibration";
import { defaultHeadBridgeConfig, validateActuatorCommand } from "@exocortex/hardware";
import { MediaRouter, type CapturedMedia } from "@exocortex/media";
import { ModelRouter } from "@exocortex/models";
import type { AgentSession, AgentSessionArtifact, AgentSessionId, AgentSessionModalityId, BrowserAction, BrowserProjectionFrame, BrowserSessionId, ModalityBindingPolicy, ModalityInstance } from "@exocortex/protocol";
import { HeadBridgeSerialSource, ManualInputBridge, ModalityRegistry } from "@exocortex/modalities";
import { ActuatorSafetyGate } from "@exocortex/safety";
import { AgentSessionManager, AgentToolRouter, createBrowserAgentTools, FileArtifactBlobStore, ModelDrivenAgentRuntime, ModalityActionRouter, ModalityObservationRouter, SQLiteAgentSessionStore } from "@exocortex/session";
import { ElectronBrowserController } from "./electron-browser-controller.js";
import { renderHtml } from "./renderer-html.js";

const modalityRegistry = new ModalityRegistry();
const hostModalities = modalityRegistry.createDefaultHostGraph();
const eventGraphStore = new SQLiteEventSourcedGraphStore(resolveEventGraphDbPath());
const eventGraph = new EventSourcedGraph({ runId: "main", store: eventGraphStore });
const eventGraphKernel = new EventGraphKernel({
  graph: eventGraph,
  behaviors: createDefaultContinuityBehaviors(),
  relationBehaviors: createDefaultContinuityRelationBehaviors()
});
const capabilityRegistry = new EventGraphCapabilityRegistry(eventGraph);
const agentSessionStore = new SQLiteAgentSessionStore(resolveAgentSessionDbPath());
const artifactBlobStore = new FileArtifactBlobStore(resolveArtifactBlobPath());
const mediaRouter = new MediaRouter();
const modelRouter = new ModelRouter();
const browserSessionManager = new BrowserSessionManager(new ElectronBrowserController());
const toolRouter = new AgentToolRouter(
  createBrowserAgentTools({
    manager: browserSessionManager,
    createSession: createBrowserSessionSurface,
    defaultSessionId: () => browserSessionManager.list()[0]?.id
  })
);
const sessionManager = new AgentSessionManager({
  store: agentSessionStore,
  runtime: new ModelDrivenAgentRuntime({
    models: modelRouter,
    tools: toolRouter,
    capabilities: capabilityRegistry,
    contextProvider: (session) =>
      renderGraphContextForPrompt(
        assembleGraphContext(eventGraph, {
          sessionId: session.id,
          capabilityKinds: ["tool", "model", "modality"],
          recentEvents: 30
        })
      )
  }),
  eventGraphKernel
});
const observationRouter = new ModalityObservationRouter(sessionManager);
const actionRouter = new ModalityActionRouter(sessionManager, {
  onActionError(event, error) {
    const message = error instanceof Error ? error.message : String(error);
    const binding = sessionManager.listBindings(event.sessionId).find((candidate) => candidate.id === event.bindingId);
    const channel = binding?.key ?? event.bindingId;
    if (event.actionType === "actuator.command") {
      recordSafetyDenial(eventGraph, {
        channel,
        code: "actuator_action_rejected",
        reason: message,
        command: event.value
      });
    }
    sessionManager.recordSessionError(event.sessionId, "modality_action_failed", message, true, event.bindingId);
  }
});

sessionManager.subscribe("*", (event) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("exocortex:session-event", event);
});
eventGraph.subscribe((event) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("exocortex:continuity-event", event);
});
browserSessionManager.subscribe((event) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("exocortex:browser-event", event);
});

const appTextModality = modalityRegistry.getModalityByKey("app_input_text") ?? hostModalities[0];
const appTextBridge = new ManualInputBridge(appTextModality);
observationRouter.attachBridge(appTextBridge);
const sttTextBridges = attachSttTextBridges();

const headBridgeModalities = modalityRegistry.createHeadBridgeGraph(defaultHeadBridgeConfig());
const headBridgeConfig = defaultHeadBridgeConfig();
const actuatorSafetyGate = ActuatorSafetyGate.fromHeadBridgeConfig(headBridgeConfig, {
  listActiveGrants: (channel, now) =>
    listActiveSafetyGrants(eventGraph, channel, now).map((object) => ({
      channel,
      reason: typeof object.data.reason === "string" ? object.data.reason : "continuity safety grant",
      armedAt: object.provenance.createdAt,
      expiresAt: typeof object.data.expiresAt === "string" ? object.data.expiresAt : object.provenance.createdAt
    }))
});
for (const policy of actuatorSafetyGate.listPolicies()) {
  acceptSafetyPolicy(eventGraph, {
    channel: policy.channel,
    policy: { ...policy },
    active: true
  });
}
publishHostCapabilities();
const headBridgeSerialPath = process.env.EXOCORTEX_HEAD_BRIDGE_SERIAL;
let headBridgeSource: HeadBridgeSerialSource | undefined;
if (headBridgeSerialPath) {
  headBridgeSource = new HeadBridgeSerialSource(
    headBridgeModalities.filter((modality) => modality.direction === "input"),
    {
      path: headBridgeSerialPath,
      baudRate: Number(process.env.EXOCORTEX_HEAD_BRIDGE_BAUD ?? 115200),
      autoReconnect: process.env.EXOCORTEX_HEAD_BRIDGE_RECONNECT !== "false",
      maxWriteQueue: Number(process.env.EXOCORTEX_HEAD_BRIDGE_MAX_WRITE_QUEUE ?? 64)
    },
    { calibrationProfile: activeHeadBridgeCalibrationProfile() }
  );
  observationRouter.attachObservationSource(
    "head_bridge_serial_source",
    headBridgeSource
  );
  for (const modality of headBridgeModalities.filter((candidate) => candidate.direction === "output")) {
    actionRouter.registerSink(modality.id, {
      send: (actionType, value) => {
        if (actionType !== "actuator.command") throw new Error(`Unsupported hardware action ${actionType} for ${modality.key}`);
        const command = validateActuatorCommand(headBridgeConfig, modality.key, normalizeRecord(value));
        actuatorSafetyGate.validate(modality.key, command);
        return headBridgeSource!.send(modality.key, actionType, {
          enabled: command.enabled,
          duty: command.duty,
          pulse_us: command.pulseUs
        });
      }
    });
  }
}
actionRouter.start();

void observationRouter.startAll().catch((error) => {
  console.error("Failed to start modality bridges", error);
});
const sttPollingBridge = startContinuousSttBridge(sttTextBridges);

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
  modelRouter.get(model);
  const session = sessionManager.create({ goal, runtime: runtimeRefForModel(model) });
  for (const modality of modalityRegistry.listModalityInstances()) {
    sessionManager.bindModality(session.id, registryBinding(session.id, modality.id));
  }
  observationRouter.bindSession(session.id, sessionManager.listBindings(session.id));
  actionRouter.bindSession(sessionManager.listBindings(session.id));
  void sessionManager.start(session.id);
  return sessionManager.get(session.id);
});
ipcMain.handle("exocortex:stop-session", (_event, sessionId: AgentSessionId) => {
  sessionManager.stop(sessionId, "Stopped by Electron operator");
  return sessionManager.get(sessionId);
});

ipcMain.handle("exocortex:list-sessions", () => sessionManager.list());
ipcMain.handle("exocortex:list-events", (_event, sessionId: AgentSessionId) => sessionManager.events(sessionId));
ipcMain.handle("exocortex:list-bindings", (_event, sessionId: AgentSessionId) => sessionManager.listBindings(sessionId));
ipcMain.handle("exocortex:update-modality-route", (_event, sessionId: AgentSessionId, bindingId: AgentSessionModalityId, policy: ModalityBindingPolicy) => {
  const updated = sessionManager.updateModalityBindingPolicy(sessionId, bindingId, policy);
  const bindings = sessionManager.listBindings(sessionId);
  observationRouter.bindSession(sessionId, bindings);
  actionRouter.bindSession(bindings);
  return updated;
});
ipcMain.handle("exocortex:list-artifacts", (_event, sessionId: AgentSessionId) => sessionManager.artifacts(sessionId));
ipcMain.handle("exocortex:list-media-providers", () => mediaRouter.list());
ipcMain.handle("exocortex:capture-media", async (_event, sessionId: AgentSessionId, kind: "image" | "audio" | "video", options: { providerId?: string; deviceId?: string; durationMs?: number } = {}) => {
  const captured = kind === "image"
    ? await mediaRouter.imageCapture(options.providerId).captureImage({ deviceId: options.deviceId, durationMs: options.durationMs })
    : kind === "audio"
      ? await mediaRouter.audioCapture(options.providerId).captureAudio({ deviceId: options.deviceId, durationMs: options.durationMs })
      : await mediaRouter.videoCapture(options.providerId).captureVideo({ deviceId: options.deviceId, durationMs: options.durationMs });
  return createMediaArtifact(sessionId, kind, captured);
});
ipcMain.handle("exocortex:synthesize-speech", async (_event, sessionId: AgentSessionId, text: string, providerId?: string) => {
  const speech = await mediaRouter.tts(providerId).synthesize(text);
  const data = speech.data ?? (speech.filePath ? await import("node:fs").then((fs) => fs.readFileSync(speech.filePath!)) : undefined);
  if (!data) throw new Error("TTS provider did not return audio data or filePath");
  const stored = artifactBlobStore.put({
    sessionId,
    kind: "audio",
    title: "Synthesized speech",
    data,
    mimeType: speech.mimeType,
    metadata: { providerId: providerId ?? "default", durationMs: speech.durationMs, ...(speech.metadata ?? {}) }
  });
  return sessionManager.createArtifact(stored.artifact);
});
ipcMain.handle("exocortex:transcribe-artifact", async (_event, sessionId: AgentSessionId, artifactId: string, providerId?: string) => {
  const artifact = sessionManager.artifacts(sessionId).find((candidate) => candidate.id === artifactId);
  if (!artifact) throw new Error(`Unknown artifact for transcription: ${artifactId}`);
  const data = artifactBlobStore.read(artifact);
  const transcript = await mediaRouter.stt(providerId).transcribe({ data, mimeType: artifact.mimeType ?? "audio/wav", filename: artifact.title });
  return sessionManager.createArtifact({
    sessionId,
    kind: "transcript",
    title: `Transcript for ${artifact.title}`,
    mimeType: "application/json",
    value: transcript,
    metadata: { sourceArtifactId: artifact.id, providerId: providerId ?? "default" }
  });
});
ipcMain.handle("exocortex:list-models", async () => ({
  models: modelRouter.list(),
  health: await modelRouter.health()
}));
ipcMain.handle("exocortex:list-modalities", () => ({
  deviceTypes: modalityRegistry.listDeviceTypes(),
  modalityTypes: modalityRegistry.listModalityTypes(),
  devices: modalityRegistry.listDeviceInstances(),
  modalities: modalityRegistry.listModalityInstances()
}));
ipcMain.handle("exocortex:transport-health", () => ({
  headBridge: headBridgeSource?.health() ?? {
    open: false,
    configured: false,
    reason: "EXOCORTEX_HEAD_BRIDGE_SERIAL is not configured"
  }
}));
ipcMain.handle("exocortex:list-continuity-objects", () => eventGraphKernel.listObjects());
ipcMain.handle("exocortex:list-continuity-relations", () => eventGraphKernel.listRelations());
ipcMain.handle("exocortex:list-continuity-events", () => eventGraph.snapshot().events);
ipcMain.handle("exocortex:inject-app-text", (_event, text: string) => appTextBridge.injectText(text));
ipcMain.handle("exocortex:send-modality-action", (_event, sessionId: AgentSessionId, bindingId: AgentSessionModalityId, actionType: string, value: unknown) =>
  sessionManager.act(sessionId, bindingId, actionType, value)
);
ipcMain.handle("exocortex:arm-actuator", (_event, channel: string, reason: string) => {
  const grant = actuatorSafetyGate.arm(channel, reason || "operator requested");
  acceptSafetyGrant(eventGraph, {
    grantId: `${grant.channel}:${grant.armedAt}`,
    channel: grant.channel,
    approvedBy: "electron-operator",
    reason: grant.reason,
    hazardous: true,
    expiresAt: grant.expiresAt,
    now: new Date(grant.armedAt)
  });
  return grant;
});
ipcMain.handle("exocortex:list-actuator-safety", () => ({
  policies: actuatorSafetyGate.listPolicies(),
  grants: actuatorSafetyGate.listGrants(),
  denials: listSafetyDenials(eventGraph)
}));
ipcMain.handle("exocortex:list-calibration-profiles", () => listActiveCalibrationProfiles(eventGraph));
ipcMain.handle("exocortex:accept-calibration-profile", (_event, profile: CalibrationProfile, supersedesProfileId?: string) => {
  validateCalibrationProfile(profile, headBridgeConfig);
  const object = acceptCalibrationProfile(eventGraph, {
    profileId: profile.id,
    deviceKey: profile.deviceKey,
    profile,
    active: true,
    supersedesProfileId
  });
  updateHeadBridgeCalibrationProfile();
  return object;
});
ipcMain.handle("exocortex:create-browser-session", async (_event, sessionId?: AgentSessionId) => {
  const browser = await createBrowserSessionSurface();
  if (sessionId) sessionManager.recordBrowserCreated(sessionId, browser.id);
  const frame = await browserSessionManager.captureFrame(browser.id);
  if (sessionId && frame) sessionManager.recordBrowserProjectionFrame(sessionId, frame);
  if (sessionId && frame) createBrowserFrameArtifact(sessionId, frame);
  return frame;
});
ipcMain.handle("exocortex:list-browser-sessions", () => browserSessionManager.list());
ipcMain.handle("exocortex:browser-dispatch", async (_event, browserSessionId: BrowserSessionId, action: BrowserAction, sessionId?: AgentSessionId) => {
  const frame = await browserSessionManager.dispatch(browserSessionId, action);
  if (sessionId) sessionManager.recordBrowserAction(sessionId, browserSessionId, action);
  if (sessionId && frame) sessionManager.recordBrowserProjectionFrame(sessionId, frame);
  if (sessionId && frame) createBrowserFrameArtifact(sessionId, frame);
  return frame;
});
ipcMain.handle("exocortex:browser-capture", async (_event, browserSessionId: BrowserSessionId, sessionId?: AgentSessionId) => {
  const frame = await browserSessionManager.captureFrame(browserSessionId);
  if (sessionId && frame) sessionManager.recordBrowserProjectionFrame(sessionId, frame);
  if (sessionId && frame) createBrowserFrameArtifact(sessionId, frame);
  return frame;
});

async function createBrowserSessionSurface() {
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
  return browserSessionManager.start(browser.id);
}

app.whenReady().then(createMainWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  sttPollingBridge?.stop();
  actionRouter.stop();
  void observationRouter.stopAll();
  eventGraphKernel.close();
  eventGraphStore.close();
  agentSessionStore.close();
});

function registryBinding(sessionId: Parameters<AgentSessionManager["listBindings"]>[0], modalityInstanceId: Parameters<ModalityRegistry["bindToSession"]>[0]["modalityInstanceId"]) {
  return modalityRegistry.bindToSession({ sessionId, modalityInstanceId });
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Hardware action value must be an object");
  return value as Record<string, unknown>;
}

function updateHeadBridgeCalibrationProfile(): void {
  headBridgeSource?.setCalibrationProfile(activeHeadBridgeCalibrationProfile());
}

function activeHeadBridgeCalibrationProfile(): CalibrationProfile | undefined {
  const profileObject = newestGraphObject(listActiveCalibrationProfiles(eventGraph, headBridgeConfig.bridgeId));
  if (!profileObject) return undefined;
  const profile = profileObject.data.profile;
  validateCalibrationProfile(profile as CalibrationProfile, headBridgeConfig);
  return profile as CalibrationProfile;
}

function newestGraphObject(objects: GraphObject[]): GraphObject | undefined {
  return [...objects].sort((a, b) => Date.parse(b.provenance.createdAt) - Date.parse(a.provenance.createdAt))[0];
}

function publishHostCapabilities(): void {
  for (const tool of toolRouter.definitions()) {
    capabilityRegistry.register({
      kind: "tool",
      key: tool.name,
      provider: "@exocortex/electron",
      version: "1",
      definition: tool
    });
  }
  for (const modality of modalityRegistry.listModalityInstances()) {
    capabilityRegistry.register({
      kind: "modality",
      key: modality.key,
      provider: modality.source,
      version: "1",
      definition: modality
    });
  }
  for (const device of modalityRegistry.listDeviceInstances()) {
    capabilityRegistry.register({
      kind: "device",
      key: device.key,
      provider: device.transport,
      version: "1",
      definition: device
    });
  }
  for (const model of modelRouter.list()) {
    capabilityRegistry.register({
      kind: "model",
      key: model.id,
      provider: model.provider,
      version: "1",
      definition: model
    });
  }
}

function resolveEventGraphDbPath(): string {
  const configured = process.env.EXOCORTEX_EVENT_GRAPH_DB;
  const dbPath = configured && configured.length > 0 ? configured : join(app.getPath("userData"), "continuity-events.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  return dbPath;
}

function resolveAgentSessionDbPath(): string {
  const configured = process.env.EXOCORTEX_AGENT_SESSION_DB;
  const dbPath = configured && configured.length > 0 ? configured : join(app.getPath("userData"), "agent-sessions.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  return dbPath;
}

function resolveArtifactBlobPath(): string {
  const configured = process.env.EXOCORTEX_ARTIFACT_BLOB_DIR;
  return configured && configured.length > 0 ? configured : join(app.getPath("userData"), "artifact-blobs");
}

function createMediaArtifact(sessionId: AgentSessionId, kind: "image" | "audio" | "video", captured: CapturedMedia): AgentSessionArtifact {
  const stored = artifactBlobStore.put({
    sessionId,
    kind,
    title: captured.filename ?? `${kind} capture`,
    data: captured.data,
    mimeType: captured.mimeType,
    metadata: {
      capturedAt: captured.capturedAt,
      sourceFilePath: captured.filePath,
      durationMs: captured.durationMs,
      ...(captured.metadata ?? {})
    }
  });
  return sessionManager.createArtifact(stored.artifact);
}

function createBrowserFrameArtifact(sessionId: AgentSessionId, frame: BrowserProjectionFrame): AgentSessionArtifact {
  const stored = artifactBlobStore.put({
    sessionId,
    kind: "image",
    title: `Browser frame ${frame.browserSessionId}`,
    data: browserFrameBytes(frame),
    mimeType: frame.mimeType,
    createdAt: frame.capturedAt,
    metadata: {
      browserSessionId: frame.browserSessionId,
      modalityInstanceId: frame.modalityInstanceId,
      width: frame.width,
      height: frame.height,
      capturedAt: frame.capturedAt
    }
  });
  return sessionManager.createArtifact(stored.artifact);
}

function browserFrameBytes(frame: BrowserProjectionFrame): Buffer {
  const dataUrl = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(frame.data);
  if (!dataUrl) return Buffer.from(frame.data);
  const encoded = dataUrl[3] ?? "";
  return dataUrl[2] ? Buffer.from(encoded, "base64") : Buffer.from(decodeURIComponent(encoded));
}

function attachSttTextBridges(): Array<{ modality: ModalityInstance; bridge: ManualInputBridge }> {
  return ["device_mic_stt_input_text", "ext_mic_1_stt_input_text", "ext_mic_2_stt_input_text"].flatMap((key) => {
    const modality = modalityRegistry.getModalityByKey(key);
    if (!modality) return [];
    const bridge = new ManualInputBridge(modality);
    observationRouter.attachBridge(bridge);
    return [{ modality, bridge }];
  });
}

function startContinuousSttBridge(bridges: Array<{ modality: ModalityInstance; bridge: ManualInputBridge }>): { stop(): void } | undefined {
  if (process.env.EXOCORTEX_STT_BRIDGE_ENABLED !== "1" || bridges.length === 0) return undefined;
  const intervalMs = Number(process.env.EXOCORTEX_STT_BRIDGE_INTERVAL_MS ?? 5_000);
  const durationMs = Number(process.env.EXOCORTEX_STT_BRIDGE_CAPTURE_MS ?? 2_500);
  const providerId = process.env.EXOCORTEX_STT_BRIDGE_PROVIDER;
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      for (const { modality, bridge } of bridges) {
        const captured = await mediaRouter.audioCapture().captureAudio({ deviceId: modality.key, durationMs });
        const transcript = await mediaRouter.stt(providerId).transcribe({
          data: captured.data,
          mimeType: captured.mimeType,
          filename: captured.filename
        });
        if (!transcript.text.trim()) continue;
        for (const session of runningSessions()) {
          const audioArtifact = createMediaArtifact(session.id, "audio", captured);
          sessionManager.createArtifact({
            sessionId: session.id,
            kind: "transcript",
            title: `STT transcript ${modality.key}`,
            mimeType: "application/json",
            value: transcript,
            metadata: {
              sourceArtifactId: audioArtifact.id,
              modalityKey: modality.key,
              providerId: providerId ?? "default"
            }
          });
        }
        bridge.injectText(transcript.text);
      }
    } catch (error) {
      console.error("Continuous STT bridge failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5_000);
  void tick();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

function runningSessions(): AgentSession[] {
  return sessionManager.list().filter((session) => session.state === "running");
}

function runtimeRefForModel(model: string) {
  const provider = modelRouter.list().find((candidate) => candidate.id === model)?.provider;
  return {
    provider: provider === "openai_compatible" ? "openai_compatible" as const
      : provider === "ollama" ? "ollama" as const
        : provider === "llama_cpp_cli" ? "llama_cpp_cli" as const
          : "local" as const,
    model,
    driver: "model-driven-agent-runtime"
  };
}
