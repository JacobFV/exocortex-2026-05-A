import type { SerialFrame } from "@exocortex/transports";

export type AnalogUnit = "raw" | "volts" | "millivolts" | "microvolts" | "ohms" | "celsius" | "lux" | "custom";
export type ActuatorKind = "digital" | "pwm" | "laser" | "headlamp" | "haptic" | "ultrasound_trigger" | "speaker_enable" | "custom";

export interface AnalogMuxConfig {
  id: string;
  signalPin: number;
  selectPins: number[];
  enablePin?: number;
  settleMicros: number;
  channels: Array<{
    index: number;
    key: string;
    unit: AnalogUnit;
    scale: number;
    offset: number;
    sampleCount: number;
  }>;
}

export interface AdcChannelConfig {
  key: string;
  pin: number;
  unit: AnalogUnit;
  scale: number;
  offset: number;
  sampleCount: number;
}

export interface ActuatorChannelConfig {
  key: string;
  pin: number;
  kind: ActuatorKind;
  activeHigh: boolean;
  pwmChannel?: number;
  pwmFrequency?: number;
  pwmResolutionBits?: number;
  maxDuty?: number;
}

export interface HeadBridgeConfig {
  bridgeId: string;
  baudRate: number;
  heartbeatMs: number;
  scanIntervalMs: number;
  analogReadResolutionBits: number;
  muxes: AnalogMuxConfig[];
  adcChannels: AdcChannelConfig[];
  actuators: ActuatorChannelConfig[];
}

export interface AnalogSample {
  raw: number;
  value: number;
  unit: AnalogUnit;
  sampleCount: number;
}

export interface ValidatedActuatorCommand {
  enabled: boolean;
  duty: number;
  pulseUs?: number;
}

export function validateHeadBridgeConfig(config: HeadBridgeConfig): void {
  if (!config.bridgeId) throw new Error("bridgeId is required");
  if (config.baudRate <= 0) throw new Error("baudRate must be positive");
  if (config.heartbeatMs <= 0) throw new Error("heartbeatMs must be positive");
  if (config.scanIntervalMs <= 0) throw new Error("scanIntervalMs must be positive");
  if (config.analogReadResolutionBits < 9 || config.analogReadResolutionBits > 16) {
    throw new Error("analogReadResolutionBits must be between 9 and 16");
  }
  const keys = new Set<string>();
  for (const channel of [...config.adcChannels, ...config.muxes.flatMap((mux) => mux.channels)]) {
    if (keys.has(channel.key)) throw new Error(`Duplicate analog channel key: ${channel.key}`);
    keys.add(channel.key);
    if (channel.sampleCount <= 0) throw new Error(`sampleCount must be positive for ${channel.key}`);
  }
  for (const actuator of config.actuators) {
    if (keys.has(actuator.key)) throw new Error(`Actuator key collides with analog channel: ${actuator.key}`);
    keys.add(actuator.key);
    if (actuator.maxDuty !== undefined && (actuator.maxDuty < 0 || actuator.maxDuty > 1)) {
      throw new Error(`maxDuty must be 0..1 for ${actuator.key}`);
    }
  }
}

export function analogSampleFrame(channel: string, sample: AnalogSample, timestamp = new Date().toISOString()): SerialFrame {
  return {
    channel,
    type: "sensor.analog_sample",
    timestamp,
    value: sample
  };
}

export function actuatorCommandFrame(channel: string, command: Record<string, unknown>, timestamp = new Date().toISOString()): SerialFrame {
  return {
    channel,
    type: "actuator.command",
    timestamp,
    value: command
  };
}

export function validateActuatorCommand(config: HeadBridgeConfig, channel: string, command: Record<string, unknown>): ValidatedActuatorCommand {
  const actuator = config.actuators.find((candidate) => candidate.key === channel);
  if (!actuator) throw new Error(`Unknown actuator channel: ${channel}`);

  const enabled = typeof command.enabled === "boolean" ? command.enabled : true;
  const requestedDuty = typeof command.duty === "number" ? command.duty : enabled ? 1 : 0;
  const maxDuty = actuator.maxDuty ?? 1;
  if (requestedDuty < 0) throw new Error(`Actuator duty must be >= 0 for ${channel}`);
  if (requestedDuty > maxDuty) throw new Error(`Actuator duty ${requestedDuty} exceeds maxDuty ${maxDuty} for ${channel}`);

  const output: ValidatedActuatorCommand = { enabled, duty: requestedDuty };
  if (command.pulse_us !== undefined) {
    if (actuator.kind !== "ultrasound_trigger") throw new Error(`pulse_us is only valid for ultrasound trigger channels`);
    if (typeof command.pulse_us !== "number" || command.pulse_us <= 0 || command.pulse_us > 100000) {
      throw new Error(`pulse_us must be 1..100000 for ${channel}`);
    }
    output.pulseUs = command.pulse_us;
  }
  return output;
}

export function defaultHeadBridgeConfig(): HeadBridgeConfig {
  return {
    bridgeId: "head_serial_bridge",
    baudRate: 115200,
    heartbeatMs: 1000,
    scanIntervalMs: 20,
    analogReadResolutionBits: 12,
    muxes: [
      {
        id: "mux_0",
        signalPin: 34,
        selectPins: [25, 26, 27, 14],
        settleMicros: 20,
        channels: [
          { index: 0, key: "eeg_ch_0_raw", unit: "microvolts", scale: 1, offset: 0, sampleCount: 4 },
          { index: 1, key: "eeg_ch_1_raw", unit: "microvolts", scale: 1, offset: 0, sampleCount: 4 },
          { index: 2, key: "skin_temp_raw", unit: "celsius", scale: 0.01, offset: 0, sampleCount: 8 },
          { index: 3, key: "ambient_light_raw", unit: "lux", scale: 1, offset: 0, sampleCount: 4 }
        ]
      }
    ],
    adcChannels: [
      { key: "battery_voltage", pin: 35, unit: "volts", scale: 0.001, offset: 0, sampleCount: 8 }
    ],
    actuators: [
      { key: "headlamp_pwm", pin: 18, kind: "headlamp", activeHigh: true, pwmChannel: 0, pwmFrequency: 1000, pwmResolutionBits: 10, maxDuty: 0.8 },
      { key: "laser_enable", pin: 19, kind: "laser", activeHigh: true },
      { key: "haptic_pwm", pin: 21, kind: "haptic", activeHigh: true, pwmChannel: 1, pwmFrequency: 200, pwmResolutionBits: 10, maxDuty: 1 },
      { key: "ultrasound_trigger", pin: 22, kind: "ultrasound_trigger", activeHigh: true }
    ]
  };
}
