import type { AgentSessionArtifact, AgentSessionArtifactId, AgentSessionId, AgentSessionModalityId } from "@exocortex/protocol";
import type { AnalogSample, AnalogUnit, HeadBridgeConfig } from "@exocortex/hardware";

export type CalibrationKind =
  | "analog_linear"
  | "adc_reference"
  | "eeg_channel"
  | "temperature_sensor"
  | "light_sensor"
  | "battery_divider"
  | "actuator_safety"
  | "screen_projection"
  | "pointer_mapping";

export interface AnalogLinearCalibration {
  kind: "analog_linear";
  channel: string;
  inputUnit: AnalogUnit;
  outputUnit: AnalogUnit;
  scale: number;
  offset: number;
  clampMin?: number;
  clampMax?: number;
}

export interface AdcReferenceCalibration {
  kind: "adc_reference";
  channel: string;
  referenceMillivolts: number;
  resolutionBits: number;
  attenuation?: string;
}

export interface EegChannelCalibration {
  kind: "eeg_channel";
  channel: string;
  microvoltsPerCount: number;
  baselineMicrovolts: number;
  notchHz?: 50 | 60;
  bandpassHz?: { low: number; high: number };
}

export interface ActuatorSafetyCalibration {
  kind: "actuator_safety";
  channel: string;
  maxDuty: number;
  maxPulseUs?: number;
  cooldownMs?: number;
  requiresUserArmed?: boolean;
}

export interface ScreenProjectionCalibration {
  kind: "screen_projection";
  channel: string;
  sourceWidth: number;
  sourceHeight: number;
  projectedWidth: number;
  projectedHeight: number;
  rotationDegrees: 0 | 90 | 180 | 270;
}

export interface PointerMappingCalibration {
  kind: "pointer_mapping";
  channel: string;
  inputBounds: Rect;
  outputBounds: Rect;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ChannelCalibration =
  | AnalogLinearCalibration
  | AdcReferenceCalibration
  | EegChannelCalibration
  | ActuatorSafetyCalibration
  | ScreenProjectionCalibration
  | PointerMappingCalibration;

export interface CalibrationProfile {
  id: string;
  name: string;
  deviceKey: string;
  createdAt: string;
  updatedAt: string;
  calibrations: ChannelCalibration[];
  metadata?: Record<string, unknown>;
}

export interface CalibrationPointPair {
  raw: number;
  expected: number;
}

export interface CalibratedAnalogSample extends AnalogSample {
  rawValue: number;
  rawUnit: AnalogUnit;
  calibrationIds: string[];
}

export function validateCalibrationProfile(profile: CalibrationProfile, config?: HeadBridgeConfig): void {
  if (!profile.id) throw new Error("Calibration profile id is required");
  if (!profile.name) throw new Error("Calibration profile name is required");
  if (!profile.deviceKey) throw new Error("Calibration profile deviceKey is required");
  const knownChannels = config ? new Set([...config.adcChannels.map((channel) => channel.key), ...config.muxes.flatMap((mux) => mux.channels.map((channel) => channel.key)), ...config.actuators.map((channel) => channel.key)]) : undefined;

  for (const calibration of profile.calibrations) {
    if (!calibration.channel) throw new Error("Calibration channel is required");
    if (knownChannels && !knownChannels.has(calibration.channel)) throw new Error(`Calibration channel is not in hardware config: ${calibration.channel}`);
    switch (calibration.kind) {
      case "analog_linear":
        assertFiniteNumber(calibration.scale, `${calibration.channel}.scale`);
        assertFiniteNumber(calibration.offset, `${calibration.channel}.offset`);
        if (calibration.clampMin !== undefined && calibration.clampMax !== undefined && calibration.clampMin > calibration.clampMax) {
          throw new Error(`clampMin must be <= clampMax for ${calibration.channel}`);
        }
        break;
      case "adc_reference":
        if (calibration.referenceMillivolts <= 0) throw new Error(`referenceMillivolts must be positive for ${calibration.channel}`);
        if (calibration.resolutionBits < 9 || calibration.resolutionBits > 24) throw new Error(`resolutionBits must be 9..24 for ${calibration.channel}`);
        break;
      case "eeg_channel":
        assertFiniteNumber(calibration.microvoltsPerCount, `${calibration.channel}.microvoltsPerCount`);
        assertFiniteNumber(calibration.baselineMicrovolts, `${calibration.channel}.baselineMicrovolts`);
        if (calibration.bandpassHz && calibration.bandpassHz.low >= calibration.bandpassHz.high) {
          throw new Error(`bandpass low must be < high for ${calibration.channel}`);
        }
        break;
      case "actuator_safety":
        if (calibration.maxDuty < 0 || calibration.maxDuty > 1) throw new Error(`maxDuty must be 0..1 for ${calibration.channel}`);
        if (calibration.maxPulseUs !== undefined && calibration.maxPulseUs <= 0) throw new Error(`maxPulseUs must be positive for ${calibration.channel}`);
        break;
      case "screen_projection":
        if (calibration.sourceWidth <= 0 || calibration.sourceHeight <= 0 || calibration.projectedWidth <= 0 || calibration.projectedHeight <= 0) {
          throw new Error(`projection dimensions must be positive for ${calibration.channel}`);
        }
        break;
      case "pointer_mapping":
        validateRect(calibration.inputBounds, `${calibration.channel}.inputBounds`);
        validateRect(calibration.outputBounds, `${calibration.channel}.outputBounds`);
        break;
    }
  }
}

export function applyAnalogCalibration(profile: CalibrationProfile, channel: string, sample: AnalogSample): CalibratedAnalogSample {
  const calibrations = profile.calibrations.filter((calibration): calibration is AnalogLinearCalibration | AdcReferenceCalibration | EegChannelCalibration => {
    return calibration.channel === channel && (calibration.kind === "analog_linear" || calibration.kind === "adc_reference" || calibration.kind === "eeg_channel");
  });
  let value = sample.value;
  let unit = sample.unit;
  const calibrationIds: string[] = [];

  for (const calibration of calibrations) {
    calibrationIds.push(`${calibration.kind}:${calibration.channel}`);
    if (calibration.kind === "analog_linear") {
      value = clamp(value * calibration.scale + calibration.offset, calibration.clampMin, calibration.clampMax);
      unit = calibration.outputUnit;
    } else if (calibration.kind === "adc_reference") {
      const maxCount = 2 ** calibration.resolutionBits - 1;
      value = (sample.raw / maxCount) * calibration.referenceMillivolts;
      unit = "millivolts";
    } else {
      value = sample.raw * calibration.microvoltsPerCount - calibration.baselineMicrovolts;
      unit = "microvolts";
    }
  }

  return {
    raw: sample.raw,
    value,
    unit,
    sampleCount: sample.sampleCount,
    rawValue: sample.value,
    rawUnit: sample.unit,
    calibrationIds
  };
}

export function mergeActuatorSafety(config: HeadBridgeConfig, profile: CalibrationProfile): HeadBridgeConfig {
  validateCalibrationProfile(profile, config);
  const safetyByChannel = new Map(profile.calibrations.filter((calibration): calibration is ActuatorSafetyCalibration => calibration.kind === "actuator_safety").map((calibration) => [calibration.channel, calibration]));
  return {
    ...config,
    actuators: config.actuators.map((actuator) => {
      const safety = safetyByChannel.get(actuator.key);
      return safety ? { ...actuator, maxDuty: Math.min(actuator.maxDuty ?? 1, safety.maxDuty) } : { ...actuator };
    })
  };
}

export function createCalibrationProfile(input: {
  id: string;
  name: string;
  deviceKey: string;
  calibrations?: ChannelCalibration[];
  metadata?: Record<string, unknown>;
  now?: Date;
}): CalibrationProfile {
  const now = (input.now ?? new Date()).toISOString();
  const profile: CalibrationProfile = {
    id: input.id,
    name: input.name,
    deviceKey: input.deviceKey,
    createdAt: now,
    updatedAt: now,
    calibrations: input.calibrations ?? [],
    metadata: input.metadata
  };
  validateCalibrationProfile(profile);
  return profile;
}

export function defaultCalibrationProfile(config: HeadBridgeConfig, now = new Date()): CalibrationProfile {
  const calibrations: ChannelCalibration[] = [
    ...config.adcChannels.map((channel): AnalogLinearCalibration => ({
      kind: "analog_linear",
      channel: channel.key,
      inputUnit: channel.unit,
      outputUnit: channel.unit,
      scale: 1,
      offset: 0
    })),
    ...config.muxes.flatMap((mux) =>
      mux.channels.map((channel): AnalogLinearCalibration => ({
        kind: "analog_linear",
        channel: channel.key,
        inputUnit: channel.unit,
        outputUnit: channel.unit,
        scale: 1,
        offset: 0
      }))
    ),
    ...config.actuators.map((actuator): ActuatorSafetyCalibration => ({
      kind: "actuator_safety",
      channel: actuator.key,
      maxDuty: actuator.maxDuty ?? 1,
      maxPulseUs: actuator.kind === "ultrasound_trigger" ? 10_000 : undefined,
      cooldownMs: actuator.kind === "ultrasound_trigger" ? 100 : undefined,
      requiresUserArmed: actuator.kind === "laser" || actuator.kind === "ultrasound_trigger"
    }))
  ];
  return createCalibrationProfile({
    id: `${config.bridgeId}_calibration`,
    name: `${config.bridgeId} calibration`,
    deviceKey: config.bridgeId,
    calibrations,
    now
  });
}

export function deriveLinearCalibration(input: {
  channel: string;
  inputUnit: AnalogUnit;
  outputUnit: AnalogUnit;
  points: CalibrationPointPair[];
  clampMin?: number;
  clampMax?: number;
}): AnalogLinearCalibration {
  if (input.points.length < 2) throw new Error("At least two calibration points are required");
  for (const point of input.points) {
    assertFiniteNumber(point.raw, `${input.channel}.raw`);
    assertFiniteNumber(point.expected, `${input.channel}.expected`);
  }
  const n = input.points.length;
  const sumX = input.points.reduce((sum, point) => sum + point.raw, 0);
  const sumY = input.points.reduce((sum, point) => sum + point.expected, 0);
  const sumXY = input.points.reduce((sum, point) => sum + point.raw * point.expected, 0);
  const sumXX = input.points.reduce((sum, point) => sum + point.raw * point.raw, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) throw new Error("Calibration points must contain at least two distinct raw values");
  const scale = (n * sumXY - sumX * sumY) / denominator;
  const offset = (sumY - scale * sumX) / n;
  return {
    kind: "analog_linear",
    channel: input.channel,
    inputUnit: input.inputUnit,
    outputUnit: input.outputUnit,
    scale,
    offset,
    clampMin: input.clampMin,
    clampMax: input.clampMax
  };
}

export function replaceChannelCalibration(profile: CalibrationProfile, calibration: ChannelCalibration, now = new Date()): CalibrationProfile {
  const calibrations = profile.calibrations.filter((candidate) => !(candidate.channel === calibration.channel && candidate.kind === calibration.kind));
  const next: CalibrationProfile = {
    ...profile,
    updatedAt: now.toISOString(),
    calibrations: [...calibrations, calibration]
  };
  validateCalibrationProfile(next);
  return next;
}

export function calibrationProfileArtifact(input: {
  artifactId: AgentSessionArtifactId;
  sessionId: AgentSessionId;
  profile: CalibrationProfile;
  modalityId?: AgentSessionModalityId;
}): AgentSessionArtifact {
  return {
    id: input.artifactId,
    sessionId: input.sessionId,
    kind: "calibration",
    title: input.profile.name,
    createdAt: new Date().toISOString(),
    modalityId: input.modalityId,
    mimeType: "application/vnd.exocortex.calibration+json",
    value: input.profile,
    metadata: {
      profileId: input.profile.id,
      deviceKey: input.profile.deviceKey,
      calibrationCount: input.profile.calibrations.length
    }
  };
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function validateRect(rect: Rect, label: string): void {
  assertFiniteNumber(rect.x, `${label}.x`);
  assertFiniteNumber(rect.y, `${label}.y`);
  if (rect.width <= 0 || rect.height <= 0) throw new Error(`${label} dimensions must be positive`);
}

function clamp(value: number, min?: number, max?: number): number {
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}
