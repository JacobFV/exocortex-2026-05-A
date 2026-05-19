import {
  createId,
  defaultTextInputModalityTypes,
  type AgentSessionId,
  type AgentSessionModalityBinding,
  type DeviceInstance,
  type DeviceInstanceId,
  type DeviceTransport,
  type DeviceType,
  type ModalityBindingPolicy,
  type ModalityInstance,
  type ModalityInstanceId,
  type ModalityType
} from "@exocortex/protocol";
import type { ActuatorKind, ActuatorChannelConfig, HeadBridgeConfig } from "@exocortex/hardware";

export type DeviceTypeDefinition = Omit<DeviceType, "id"> & { id?: DeviceType["id"] };
export type ModalityTypeDefinition = Omit<ModalityType, "id"> & { id?: ModalityType["id"] };

export interface CreateDeviceInstanceInput {
  typeKey: string;
  key: string;
  label?: string;
  transport: DeviceTransport;
  parentDeviceId?: DeviceInstanceId;
  metadata?: Record<string, unknown>;
}

export interface CreateModalityInstanceInput {
  typeKey: string;
  key?: string;
  label?: string;
  deviceId?: DeviceInstanceId;
  source: ModalityInstance["source"];
  transport?: DeviceTransport;
  reliability?: ModalityInstance["reliability"];
  metadata?: Record<string, unknown>;
}

export interface BindModalityInput {
  sessionId: AgentSessionId;
  modalityInstanceId: ModalityInstanceId;
  policy?: ModalityBindingPolicy;
  metadata?: Record<string, unknown>;
}

export class ModalityRegistry {
  private readonly deviceTypes = new Map<string, DeviceType>();
  private readonly modalityTypes = new Map<string, ModalityType>();
  private readonly deviceInstances = new Map<DeviceInstanceId, DeviceInstance>();
  private readonly modalityInstances = new Map<ModalityInstanceId, ModalityInstance>();

  registerDefaultCatalog(): void {
    this.registerDeviceType({
      key: "host_unix_device",
      label: "Unix host device",
      attachment: "host",
      transports: ["local", "ipc"],
      capabilities: ["agent.host", "media.integrated", "ui.frontend"]
    });
    this.registerDeviceType({
      key: "serial_microcontroller",
      label: "Serial microcontroller",
      attachment: "microcontroller",
      transports: ["serial", "usb"],
      capabilities: ["device.bridge", "sensor.fanout", "actuator.fanout"]
    });
    this.registerDeviceType({
      key: "esp32_head_bridge",
      label: "ESP32 head bridge",
      attachment: "microcontroller",
      transports: ["serial", "usb", "wifi", "ble"],
      capabilities: ["adc.scan", "analog_mux.scan", "actuator.control", "heartbeat"]
    });
    this.registerDeviceType({
      key: "browser_session",
      label: "Browser session",
      attachment: "virtual",
      transports: ["ipc", "websocket"],
      capabilities: ["browser.control", "screen.project", "input.pointer", "input.keyboard"]
    });
    for (const definition of defaultTextInputModalityTypes) {
      this.registerModalityType(definition);
    }
    this.registerModalityType({
      key: "browser_projected_screen",
      label: "Browser projected screen",
      direction: "output",
      kind: "browser",
      capabilities: ["screen.frame", "screen.project"],
      defaultPolicy: "observe"
    });
    this.registerModalityType({
      key: "browser_control_input",
      label: "Browser pointer keyboard touch input",
      direction: "input",
      kind: "browser",
      capabilities: ["pointer.click", "pointer.move", "touch.gesture", "keyboard.key", "keyboard.text"],
      defaultPolicy: "control"
    });
  }

  createDefaultHostGraph(): ModalityInstance[] {
    if (!this.deviceTypes.size || !this.modalityTypes.size) this.registerDefaultCatalog();
    const host = this.createDeviceInstance({
      typeKey: "host_unix_device",
      key: "host",
      label: "Current Unix host",
      transport: "local"
    });
    const serialBridge = this.createDeviceInstance({
      typeKey: "serial_microcontroller",
      key: "head_serial_bridge",
      label: "Head serial bridge",
      transport: "serial",
      parentDeviceId: host.id
    });
    return [
      this.createModalityInstance({ typeKey: "app_input_text", deviceId: host.id, source: "app", transport: "local" }),
      this.createModalityInstance({ typeKey: "device_mic_stt_input_text", deviceId: host.id, source: "host_device", transport: "local" }),
      this.createModalityInstance({ typeKey: "ext_mic_1_stt_input_text", deviceId: serialBridge.id, source: "external_device", transport: "serial" }),
      this.createModalityInstance({ typeKey: "ext_mic_2_stt_input_text", deviceId: serialBridge.id, source: "external_device", transport: "serial" })
    ];
  }

  createHeadBridgeGraph(config: HeadBridgeConfig, parentDeviceId?: DeviceInstanceId): ModalityInstance[] {
    if (!this.deviceTypes.size || !this.modalityTypes.size) this.registerDefaultCatalog();
    const bridge = this.createDeviceInstance({
      typeKey: "esp32_head_bridge",
      key: config.bridgeId,
      label: config.bridgeId,
      transport: "serial",
      parentDeviceId,
      metadata: {
        baudRate: config.baudRate,
        heartbeatMs: config.heartbeatMs,
        scanIntervalMs: config.scanIntervalMs
      }
    });

    const instances: ModalityInstance[] = [];
    for (const channel of config.adcChannels) {
      instances.push(this.createSensorModality(bridge.id, channel.key, inferSensorKind(channel.key), channel.unit));
    }
    for (const mux of config.muxes) {
      for (const channel of mux.channels) {
        instances.push(
          this.createSensorModality(bridge.id, channel.key, inferSensorKind(channel.key), channel.unit, {
            muxId: mux.id,
            muxIndex: channel.index
          })
        );
      }
    }
    for (const actuator of config.actuators) {
      instances.push(this.createActuatorModality(bridge.id, actuator.key, inferActuatorKind(actuator.kind), actuator));
    }
    return instances;
  }

  registerDeviceType(definition: DeviceTypeDefinition): DeviceType {
    if (this.deviceTypes.has(definition.key)) return this.deviceTypes.get(definition.key)!;
    const type: DeviceType = { ...definition, id: definition.id ?? createId<"DeviceTypeId">("devtype") };
    this.deviceTypes.set(type.key, type);
    return type;
  }

  registerModalityType(definition: ModalityTypeDefinition): ModalityType {
    if (this.modalityTypes.has(definition.key)) return this.modalityTypes.get(definition.key)!;
    const type: ModalityType = { ...definition, id: definition.id ?? createId<"ModalityTypeId">("modtype") };
    this.modalityTypes.set(type.key, type);
    return type;
  }

  createDeviceInstance(input: CreateDeviceInstanceInput): DeviceInstance {
    const type = this.requireDeviceType(input.typeKey);
    const parent = input.parentDeviceId ? this.deviceInstances.get(input.parentDeviceId) : undefined;
    const now = new Date().toISOString();
    const instance: DeviceInstance = {
      id: createId<"DeviceInstanceId">("dev"),
      typeId: type.id,
      key: input.key,
      label: input.label ?? type.label,
      state: "connected",
      transport: input.transport,
      parentDeviceId: input.parentDeviceId,
      path: [...(parent?.path ?? []), input.key],
      connectedAt: now,
      updatedAt: now,
      metadata: input.metadata
    };
    this.deviceInstances.set(instance.id, instance);
    return instance;
  }

  createModalityInstance(input: CreateModalityInstanceInput): ModalityInstance {
    const type = this.requireModalityType(input.typeKey);
    const device = input.deviceId ? this.deviceInstances.get(input.deviceId) : undefined;
    const now = new Date().toISOString();
    const instance: ModalityInstance = {
      id: createId<"ModalityInstanceId">("mod"),
      typeId: type.id,
      key: input.key ?? type.key,
      label: input.label ?? type.label,
      direction: type.direction,
      kind: type.kind,
      deviceId: input.deviceId,
      source: input.source,
      transport: input.transport,
      capabilities: [...type.capabilities],
      state: "active",
      reliability: input.reliability,
      path: [...(device?.path ?? []), input.key ?? type.key],
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata
    };
    this.modalityInstances.set(instance.id, instance);
    return instance;
  }

  private createSensorModality(deviceId: DeviceInstanceId, key: string, kind: ModalityType["kind"], unit: string, metadata?: Record<string, unknown>): ModalityInstance {
    this.registerModalityType({
      key,
      label: key,
      direction: "input",
      kind,
      capabilities: ["sensor.sample", `unit.${unit}`],
      defaultPolicy: "observe",
      metadata
    });
    return this.createModalityInstance({
      typeKey: key,
      deviceId,
      source: "microcontroller",
      transport: "serial",
      metadata
    });
  }

  private createActuatorModality(deviceId: DeviceInstanceId, key: string, kind: ModalityType["kind"], actuator: ActuatorChannelConfig): ModalityInstance {
    const metadata = { ...actuator } satisfies Record<string, unknown>;
    this.registerModalityType({
      key,
      label: key,
      direction: "output",
      kind,
      capabilities: ["actuator.command"],
      defaultPolicy: "control",
      metadata
    });
    return this.createModalityInstance({
      typeKey: key,
      deviceId,
      source: "microcontroller",
      transport: "serial",
      metadata
    });
  }

  bindToSession(input: BindModalityInput): AgentSessionModalityBinding {
    const modality = this.requireModalityInstance(input.modalityInstanceId);
    const type = [...this.modalityTypes.values()].find((candidate) => candidate.id === modality.typeId);
    return {
      id: createId<"AgentSessionModalityId">("bind"),
      sessionId: input.sessionId,
      modalityInstanceId: modality.id,
      key: modality.key,
      label: modality.label,
      direction: modality.direction,
      kind: modality.kind,
      policy: input.policy ?? type?.defaultPolicy ?? "observe",
      source: modality.source,
      deviceId: modality.deviceId,
      capabilities: [...modality.capabilities],
      boundAt: new Date().toISOString(),
      metadata: input.metadata
    };
  }

  listDeviceTypes(): DeviceType[] {
    return [...this.deviceTypes.values()].map((type) => ({ ...type, transports: [...type.transports], capabilities: [...type.capabilities] }));
  }

  listModalityTypes(): ModalityType[] {
    return [...this.modalityTypes.values()].map((type) => ({ ...type, capabilities: [...type.capabilities] }));
  }

  listDeviceInstances(): DeviceInstance[] {
    return [...this.deviceInstances.values()].map((instance) => ({ ...instance, path: [...instance.path] }));
  }

  listModalityInstances(): ModalityInstance[] {
    return [...this.modalityInstances.values()].map((instance) => ({
      ...instance,
      capabilities: [...instance.capabilities],
      path: [...instance.path]
    }));
  }

  getModalityByKey(key: string): ModalityInstance | undefined {
    return this.listModalityInstances().find((instance) => instance.key === key);
  }

  private requireDeviceType(key: string): DeviceType {
    const type = this.deviceTypes.get(key);
    if (!type) throw new Error(`Unknown device type: ${key}`);
    return type;
  }

  private requireModalityType(key: string): ModalityType {
    const type = this.modalityTypes.get(key);
    if (!type) throw new Error(`Unknown modality type: ${key}`);
    return type;
  }

  private requireModalityInstance(id: ModalityInstanceId): ModalityInstance {
    const instance = this.modalityInstances.get(id);
    if (!instance) throw new Error(`Unknown modality instance: ${id}`);
    return instance;
  }
}

function inferSensorKind(key: string): ModalityType["kind"] {
  if (key.startsWith("eeg_")) return "eeg";
  if (key.includes("light")) return "sensor";
  if (key.includes("battery")) return "sensor";
  if (key.includes("temp")) return "sensor";
  return "sensor";
}

function inferActuatorKind(kind: ActuatorKind): ModalityType["kind"] {
  switch (kind) {
    case "headlamp":
      return "lighting";
    case "laser":
      return "laser";
    case "haptic":
      return "haptic";
    case "ultrasound_trigger":
      return "ultrasound";
    default:
      return "actuator";
  }
}
