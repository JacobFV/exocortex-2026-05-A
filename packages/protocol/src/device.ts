import type { DeviceInstanceId, DeviceTypeId } from "./id.js";

export type DeviceTransport = "local" | "serial" | "usb" | "ble" | "wifi" | "websocket" | "http" | "ipc" | "i2c" | "spi" | "custom";
export type DeviceAttachment = "host" | "microcontroller" | "sensor" | "actuator" | "virtual" | "remote";
export type DeviceInstanceState = "discovered" | "connecting" | "connected" | "degraded" | "disconnected" | "error";

export interface DeviceType {
  id: DeviceTypeId;
  key: string;
  label: string;
  attachment: DeviceAttachment;
  transports: DeviceTransport[];
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

export interface DeviceInstance {
  id: DeviceInstanceId;
  typeId: DeviceTypeId;
  key: string;
  label: string;
  state: DeviceInstanceState;
  transport: DeviceTransport;
  parentDeviceId?: DeviceInstanceId;
  path: string[];
  connectedAt?: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}
