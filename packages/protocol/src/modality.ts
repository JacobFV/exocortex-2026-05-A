import type { AgentSessionId } from "./id.js";
import type {
  AgentSessionModalityId,
  DeviceInstanceId,
  ModalityInstanceId,
  ModalityTypeId
} from "./id.js";
import type { DeviceTransport } from "./device.js";

export type ModalityDirection = "input" | "output" | "duplex";

export type ModalityKind =
  | "text"
  | "audio"
  | "video"
  | "image"
  | "sensor"
  | "actuator"
  | "browser"
  | "computer"
  | "haptic"
  | "lighting"
  | "laser"
  | "ultrasound"
  | "eeg"
  | "serial"
  | "system"
  | "custom";

export type ModalityReliability = "unknown" | "low" | "medium" | "high";
export type ModalityInstanceState = "registered" | "starting" | "active" | "paused" | "stopped" | "error";
export type ModalityBindingPolicy = "observe" | "control" | "observe_and_control" | "disabled";

export interface ModalityType {
  id: ModalityTypeId;
  key: string;
  label: string;
  direction: ModalityDirection;
  kind: ModalityKind;
  capabilities: string[];
  defaultPolicy: ModalityBindingPolicy;
  metadata?: Record<string, unknown>;
}

export interface ModalityInstance {
  id: ModalityInstanceId;
  typeId: ModalityTypeId;
  key: string;
  label: string;
  direction: ModalityDirection;
  kind: ModalityKind;
  deviceId?: DeviceInstanceId;
  source:
    | "app"
    | "host_device"
    | "external_device"
    | "microcontroller"
    | "browser_session"
    | "computer_session"
    | "agent_runtime"
    | "virtual";
  transport?: DeviceTransport;
  capabilities: string[];
  state: ModalityInstanceState;
  reliability?: ModalityReliability;
  path: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface AgentSessionModalityBinding {
  id: AgentSessionModalityId;
  sessionId: AgentSessionId;
  modalityInstanceId: ModalityInstanceId;
  key: string;
  label: string;
  direction: ModalityDirection;
  kind: ModalityKind;
  policy: ModalityBindingPolicy;
  source: ModalityInstance["source"];
  deviceId?: DeviceInstanceId;
  capabilities: string[];
  boundAt: string;
  metadata?: Record<string, unknown>;
}

export const defaultTextInputModalityTypes = [
  {
    key: "app_input_text",
    label: "App text input",
    direction: "input",
    kind: "text",
    capabilities: ["text.intent", "text.freeform"],
    defaultPolicy: "observe"
  },
  {
    key: "device_mic_stt_input_text",
    label: "Device microphone STT text",
    direction: "input",
    kind: "text",
    capabilities: ["speech.transcript", "speech.partial_transcript"],
    defaultPolicy: "observe"
  },
  {
    key: "ext_mic_1_stt_input_text",
    label: "External microphone 1 STT text",
    direction: "input",
    kind: "text",
    capabilities: ["speech.transcript", "speech.partial_transcript"],
    defaultPolicy: "observe"
  },
  {
    key: "ext_mic_2_stt_input_text",
    label: "External microphone 2 STT text",
    direction: "input",
    kind: "text",
    capabilities: ["speech.transcript", "speech.partial_transcript"],
    defaultPolicy: "observe"
  }
] satisfies Array<Omit<ModalityType, "id">>;
