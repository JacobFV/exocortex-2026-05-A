import type { AgentSessionModalityId } from "./id.js";

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

export interface AgentSessionModality {
  id: AgentSessionModalityId;
  key: string;
  label: string;
  direction: ModalityDirection;
  kind: ModalityKind;
  source:
    | "app"
    | "host_device"
    | "external_device"
    | "microcontroller"
    | "browser_session"
    | "computer_session"
    | "agent_runtime"
    | "virtual";
  transport?: "local" | "serial" | "usb" | "ble" | "wifi" | "websocket" | "http" | "ipc" | "custom";
  capabilities: string[];
  reliability?: ModalityReliability;
  metadata?: Record<string, unknown>;
}

export const defaultTextInputModalities = [
  {
    key: "app_input_text",
    label: "App text input",
    direction: "input",
    kind: "text",
    source: "app",
    capabilities: ["text.intent", "text.freeform"]
  },
  {
    key: "device_mic_stt_input_text",
    label: "Device microphone STT text",
    direction: "input",
    kind: "text",
    source: "host_device",
    capabilities: ["speech.transcript", "speech.partial_transcript"]
  },
  {
    key: "ext_mic_1_stt_input_text",
    label: "External microphone 1 STT text",
    direction: "input",
    kind: "text",
    source: "external_device",
    transport: "serial",
    capabilities: ["speech.transcript", "speech.partial_transcript"]
  },
  {
    key: "ext_mic_2_stt_input_text",
    label: "External microphone 2 STT text",
    direction: "input",
    kind: "text",
    source: "external_device",
    transport: "serial",
    capabilities: ["speech.transcript", "speech.partial_transcript"]
  }
] satisfies Array<Omit<AgentSessionModality, "id">>;
