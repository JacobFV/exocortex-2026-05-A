import type { ModalityInstance } from "@exocortex/protocol";
import type { ModalityBridge, ModalityObservation } from "@exocortex/peripherals";

export type ExpoPermissionStatus = "granted" | "denied" | "undetermined";

export interface ExpoPermissionResponse {
  status: ExpoPermissionStatus | string;
  granted?: boolean;
  canAskAgain?: boolean;
  expires?: string | number;
}

export interface ExpoNativeCapability {
  available: boolean;
  reason?: string;
  permission?: ExpoPermissionResponse;
  checkedAt: string;
}

export type ExpoNativeActionHandler = (value: unknown) => Promise<unknown> | unknown;

export interface ExpoNativeDeviceBridgeOptions<ActionType extends string = string> {
  modality: ModalityInstance;
  capabilityKind: "microphone" | "camera" | "speaker";
  checkCapability: () => Promise<Omit<ExpoNativeCapability, "checkedAt">> | Omit<ExpoNativeCapability, "checkedAt">;
  actions?: Partial<Record<ActionType, ExpoNativeActionHandler>>;
}

export class ExpoNativeDeviceBridge<ActionType extends string = string> implements ModalityBridge {
  private readonly listeners = new Set<(observation: ModalityObservation) => void>();
  private lastCapability?: ExpoNativeCapability;

  constructor(private readonly options: ExpoNativeDeviceBridgeOptions<ActionType>) {}

  get modality(): ModalityInstance {
    return this.options.modality;
  }

  async start(): Promise<void> {
    await this.refreshCapability();
  }

  async stop(): Promise<void> {
    this.listeners.clear();
  }

  subscribe(listener: (observation: ModalityObservation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(actionType: string, value: unknown): Promise<void> {
    const capability = this.lastCapability ?? (await this.refreshCapability());
    if (!capability.available) {
      this.emit("device.action_unavailable", { actionType, reason: capability.reason ?? "capability unavailable" });
      return;
    }

    const handler = this.options.actions?.[actionType as ActionType];
    if (!handler) {
      this.emit("device.action_unavailable", { actionType, reason: "action unsupported" });
      return;
    }

    const result = await handler(value);
    this.emit("device.action_completed", { actionType, result });
  }

  async refreshCapability(): Promise<ExpoNativeCapability> {
    const checked = await this.options.checkCapability();
    const capability = { ...checked, checkedAt: new Date().toISOString() };
    this.lastCapability = capability;
    this.emit("device.capability", {
      capability: this.options.capabilityKind,
      ...capability
    });
    if (capability.permission) {
      this.emit("device.permission", {
        capability: this.options.capabilityKind,
        permission: capability.permission
      });
    }
    return capability;
  }

  private emit(observationType: string, value: unknown): void {
    const observation: ModalityObservation = {
      modalityInstanceId: this.modality.id,
      observationType,
      value,
      observedAt: new Date().toISOString()
    };
    for (const listener of this.listeners) listener(observation);
  }
}

export interface ExpoMicrophoneModule {
  getPermissionsAsync?: () => Promise<ExpoPermissionResponse>;
  requestPermissionsAsync?: () => Promise<ExpoPermissionResponse>;
  startRecordingAsync?: (value: unknown) => Promise<unknown>;
  stopRecordingAsync?: (value: unknown) => Promise<unknown>;
}

export type ExpoMicrophoneAction = "permission.request" | "recording.start" | "recording.stop";

export function createExpoMicrophoneBridge(
  modality: ModalityInstance,
  microphone?: ExpoMicrophoneModule
): ExpoNativeDeviceBridge<ExpoMicrophoneAction> {
  const actions: Partial<Record<ExpoMicrophoneAction, ExpoNativeActionHandler>> = {};
  if (microphone?.requestPermissionsAsync) actions["permission.request"] = () => microphone.requestPermissionsAsync!();
  if (microphone?.startRecordingAsync) actions["recording.start"] = (value) => microphone.startRecordingAsync!(value);
  if (microphone?.stopRecordingAsync) actions["recording.stop"] = (value) => microphone.stopRecordingAsync!(value);

  return new ExpoNativeDeviceBridge<ExpoMicrophoneAction>({
    modality,
    capabilityKind: "microphone",
    checkCapability: async () => {
      if (!microphone) return { available: false, reason: "microphone module not installed" };
      const permission = await microphone.getPermissionsAsync?.();
      return { available: true, permission };
    },
    actions
  });
}

export interface ExpoCameraModule {
  getCameraPermissionsAsync?: () => Promise<ExpoPermissionResponse>;
  requestCameraPermissionsAsync?: () => Promise<ExpoPermissionResponse>;
  takePictureAsync?: (value: unknown) => Promise<unknown>;
  setPreviewEnabledAsync?: (value: unknown) => Promise<unknown>;
}

export type ExpoCameraAction = "permission.request" | "image.capture" | "preview.set_enabled";

export function createExpoCameraBridge(modality: ModalityInstance, camera?: ExpoCameraModule): ExpoNativeDeviceBridge<ExpoCameraAction> {
  const actions: Partial<Record<ExpoCameraAction, ExpoNativeActionHandler>> = {};
  if (camera?.requestCameraPermissionsAsync) actions["permission.request"] = () => camera.requestCameraPermissionsAsync!();
  if (camera?.takePictureAsync) actions["image.capture"] = (value) => camera.takePictureAsync!(value);
  if (camera?.setPreviewEnabledAsync) actions["preview.set_enabled"] = (value) => camera.setPreviewEnabledAsync!(value);

  return new ExpoNativeDeviceBridge<ExpoCameraAction>({
    modality,
    capabilityKind: "camera",
    checkCapability: async () => {
      if (!camera) return { available: false, reason: "camera module not installed" };
      const permission = await camera.getCameraPermissionsAsync?.();
      return { available: true, permission };
    },
    actions
  });
}

export interface ExpoSpeakerModule {
  setAudioModeAsync?: (value: unknown) => Promise<unknown>;
  playAsync?: (value: unknown) => Promise<unknown>;
  stopAsync?: (value: unknown) => Promise<unknown>;
  speakAsync?: (value: unknown) => Promise<unknown>;
}

export type ExpoSpeakerAction = "speaker.mode.set" | "audio.play" | "audio.stop" | "speech.speak";

export function createExpoSpeakerBridge(modality: ModalityInstance, speaker?: ExpoSpeakerModule): ExpoNativeDeviceBridge<ExpoSpeakerAction> {
  const actions: Partial<Record<ExpoSpeakerAction, ExpoNativeActionHandler>> = {};
  if (speaker?.setAudioModeAsync) actions["speaker.mode.set"] = (value) => speaker.setAudioModeAsync!(value);
  if (speaker?.playAsync) actions["audio.play"] = (value) => speaker.playAsync!(value);
  if (speaker?.stopAsync) actions["audio.stop"] = (value) => speaker.stopAsync!(value);
  if (speaker?.speakAsync) actions["speech.speak"] = (value) => speaker.speakAsync!(value);

  return new ExpoNativeDeviceBridge<ExpoSpeakerAction>({
    modality,
    capabilityKind: "speaker",
    checkCapability: () => {
      if (!speaker) return { available: false, reason: "speaker module not installed" };
      return { available: true };
    },
    actions
  });
}

export interface ExpoNativeModules {
  microphone?: ExpoMicrophoneModule;
  camera?: ExpoCameraModule;
  speaker?: ExpoSpeakerModule;
}

export function createExpoNativeDeviceBridges(
  modalities: ModalityInstance[],
  modules: ExpoNativeModules = {}
): ExpoNativeDeviceBridge[] {
  const bridges: ExpoNativeDeviceBridge[] = [];
  for (const modality of modalities) {
    if (modality.key === "expo_device_microphone_audio") bridges.push(createExpoMicrophoneBridge(modality, modules.microphone));
    if (modality.key === "expo_device_camera_video") bridges.push(createExpoCameraBridge(modality, modules.camera));
    if (modality.key === "expo_device_speaker_audio") bridges.push(createExpoSpeakerBridge(modality, modules.speaker));
  }
  return bridges;
}
