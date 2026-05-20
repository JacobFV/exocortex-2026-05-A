import { applyAnalogCalibration, type CalibrationProfile } from "@exocortex/calibration";
import type { AnalogSample } from "@exocortex/hardware";
import type { ModalityInstance } from "@exocortex/protocol";
import { NodeSerialTransport, type NodeSerialTransportOptions, type SerialFrame } from "@exocortex/transports";
import type { SerialTransportHealth } from "@exocortex/transports";
import type { ModalityObservation } from "./bridge.js";

export interface HeadBridgeSerialSourceOptions {
  calibrationProfile?: CalibrationProfile;
}

export class HeadBridgeSerialSource {
  private readonly transport: NodeSerialTransport;
  private readonly modalitiesByKey = new Map<string, ModalityInstance>();
  private readonly listeners = new Set<(observation: ModalityObservation) => void>();
  private calibrationProfile?: CalibrationProfile;

  constructor(modalities: ModalityInstance[], options: NodeSerialTransportOptions, sourceOptions: HeadBridgeSerialSourceOptions = {}) {
    this.transport = new NodeSerialTransport(options);
    this.calibrationProfile = sourceOptions.calibrationProfile;
    for (const modality of modalities) {
      this.modalitiesByKey.set(modality.key, modality);
    }
  }

  async start(): Promise<void> {
    this.transport.on("frame", (frame) => this.handleFrame(frame));
    this.transport.on("error", (error) => {
      throw error;
    });
    await this.transport.open();
  }

  async stop(): Promise<void> {
    this.listeners.clear();
    await this.transport.close();
  }

  subscribe(listener: (observation: ModalityObservation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(channel: string, actionType: string, value: unknown): Promise<void> {
    await this.transport.write({
      channel,
      type: actionType,
      value,
      timestamp: new Date().toISOString()
    });
  }

  health(): SerialTransportHealth {
    return this.transport.health();
  }

  setCalibrationProfile(profile: CalibrationProfile | undefined): void {
    this.calibrationProfile = profile;
  }

  private handleFrame(frame: SerialFrame): void {
    const modality = this.modalitiesByKey.get(frame.channel);
    if (!modality) return;
    for (const listener of this.listeners) {
      listener({
        modalityInstanceId: modality.id,
        observationType: frame.type,
        value: normalizeHeadBridgeFrameValue(frame, this.calibrationProfile),
        observedAt: frame.timestamp ?? new Date().toISOString()
      });
    }
  }
}

export function normalizeHeadBridgeFrameValue(frame: SerialFrame, calibrationProfile?: CalibrationProfile): unknown {
  if (frame.type !== "sensor.analog_sample") return frame.value;
  const sample = parseAnalogSample(frame.value);
  return calibrationProfile ? applyAnalogCalibration(calibrationProfile, frame.channel, sample) : sample;
}

function parseAnalogSample(value: unknown): AnalogSample {
  if (!isRecord(value)) throw new Error("Analog sample value must be an object");
  const raw = numberField(value, "raw");
  const sampleCount = numberField(value, "sampleCount", "sample_count");
  return {
    raw,
    value: numberField(value, "value"),
    unit: stringField(value, "unit") as AnalogSample["unit"],
    sampleCount
  };
}

function numberField(value: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  throw new Error(`Missing numeric field: ${keys.join(" or ")}`);
}

function stringField(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  if (typeof candidate === "string") return candidate;
  throw new Error(`Missing string field: ${key}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
