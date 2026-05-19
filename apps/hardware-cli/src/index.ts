#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import {
  applyAnalogCalibration,
  defaultCalibrationProfile,
  deriveLinearCalibration,
  replaceChannelCalibration,
  validateCalibrationProfile,
  type CalibrationProfile
} from "@exocortex/calibration";
import { defaultHeadBridgeConfig, validateActuatorCommand, validateHeadBridgeConfig, type AnalogUnit } from "@exocortex/hardware";
import { NodeSerialTransport, type SerialFrame } from "@exocortex/transports";

export type HardwareCliCommand =
  | { name: "config" }
  | { name: "calibration-template"; output?: string }
  | { name: "calibration-validate"; profile: string }
  | { name: "calibration-derive-linear"; profile: string; output?: string; channel: string; inputUnit: AnalogUnit; outputUnit: AnalogUnit; points: Array<{ raw: number; expected: number }> }
  | { name: "calibration-apply-sample"; profile: string; channel: string; raw: number; value: number; unit: AnalogUnit; sampleCount: number }
  | { name: "listen"; port: string; baudRate: number }
  | { name: "inspect"; port: string; baudRate: number; durationMs: number }
  | { name: "ping"; port: string; baudRate: number; durationMs: number }
  | { name: "actuate"; port: string; baudRate: number; channel: string; value: Record<string, unknown>; durationMs: number };

export function parseHardwareCliArgs(argv: string[]): HardwareCliCommand {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  switch (command) {
    case "config":
      return { name: "config" };
    case "calibration-template":
      return { name: "calibration-template", output: options.output };
    case "calibration-validate":
      return { name: "calibration-validate", profile: required(options, "profile") };
    case "calibration-derive-linear":
      return {
        name: "calibration-derive-linear",
        profile: required(options, "profile"),
        output: options.output,
        channel: required(options, "channel"),
        inputUnit: parseAnalogUnit(required(options, "input-unit")),
        outputUnit: parseAnalogUnit(required(options, "output-unit")),
        points: parsePointPairs(required(options, "points"))
      };
    case "calibration-apply-sample":
      return {
        name: "calibration-apply-sample",
        profile: required(options, "profile"),
        channel: required(options, "channel"),
        raw: numberOption(options, "raw"),
        value: numberOption(options, "value"),
        unit: parseAnalogUnit(required(options, "unit")),
        sampleCount: numberOption(options, "sample-count")
      };
    case "listen":
      return { name: "listen", port: required(options, "port"), baudRate: numberOption(options, "baud", defaultHeadBridgeConfig().baudRate) };
    case "inspect":
      return {
        name: "inspect",
        port: required(options, "port"),
        baudRate: numberOption(options, "baud", defaultHeadBridgeConfig().baudRate),
        durationMs: numberOption(options, "duration-ms", 2000)
      };
    case "ping":
      return {
        name: "ping",
        port: required(options, "port"),
        baudRate: numberOption(options, "baud", defaultHeadBridgeConfig().baudRate),
        durationMs: numberOption(options, "duration-ms", 1000)
      };
    case "actuate": {
      const config = defaultHeadBridgeConfig();
      const channel = required(options, "channel");
      const rawValue: Record<string, unknown> = {};
      if (options.enabled !== undefined) rawValue.enabled = booleanOption(options, "enabled");
      if (options.duty !== undefined) rawValue.duty = numberOption(options, "duty");
      if (options["pulse-us"] !== undefined) rawValue.pulse_us = numberOption(options, "pulse-us");
      const validated = validateActuatorCommand(config, channel, rawValue);
      return {
        name: "actuate",
        port: required(options, "port"),
        baudRate: numberOption(options, "baud", config.baudRate),
        channel,
        value: validated.pulseUs === undefined ? { enabled: validated.enabled, duty: validated.duty } : { enabled: validated.enabled, duty: validated.duty, pulse_us: validated.pulseUs },
        durationMs: numberOption(options, "duration-ms", 500)
      };
    }
    default:
      throw new Error(usage(command));
  }
}

export async function runHardwareCli(command: HardwareCliCommand, writeLine: (line: string) => void = console.log): Promise<void> {
  if (command.name === "config") {
    const config = defaultHeadBridgeConfig();
    validateHeadBridgeConfig(config);
    writeLine(JSON.stringify(config, null, 2));
    return;
  }
  if (command.name === "calibration-template") {
    const profile = defaultCalibrationProfile(defaultHeadBridgeConfig());
    writeJson(command.output, profile, writeLine);
    return;
  }
  if (command.name === "calibration-validate") {
    const profile = readCalibrationProfile(command.profile);
    validateCalibrationProfile(profile, defaultHeadBridgeConfig());
    writeLine(JSON.stringify({ status: "ok", profileId: profile.id, calibrationCount: profile.calibrations.length }));
    return;
  }
  if (command.name === "calibration-derive-linear") {
    const profile = readCalibrationProfile(command.profile);
    const calibration = deriveLinearCalibration({
      channel: command.channel,
      inputUnit: command.inputUnit,
      outputUnit: command.outputUnit,
      points: command.points
    });
    const next = replaceChannelCalibration(profile, calibration);
    validateCalibrationProfile(next, defaultHeadBridgeConfig());
    writeJson(command.output ?? command.profile, next, writeLine);
    return;
  }
  if (command.name === "calibration-apply-sample") {
    const profile = readCalibrationProfile(command.profile);
    validateCalibrationProfile(profile, defaultHeadBridgeConfig());
    writeLine(
      JSON.stringify(
        applyAnalogCalibration(profile, command.channel, {
          raw: command.raw,
          value: command.value,
          unit: command.unit,
          sampleCount: command.sampleCount
        })
      )
    );
    return;
  }

  const transport = new NodeSerialTransport({ path: command.port, baudRate: command.baudRate });
  transport.on("frame", (frame) => writeLine(JSON.stringify(frame)));
  transport.on("error", (error) => {
    throw error;
  });

  await transport.open();
  try {
    if (command.name === "listen") {
      await waitForSignal();
      return;
    }
    if (command.name === "inspect" || command.name === "ping") {
      await transport.write(systemPingFrame());
      await delay(command.durationMs);
      return;
    }
    await transport.write({
      channel: command.channel,
      type: "actuator.command",
      timestamp: new Date().toISOString(),
      value: command.value
    });
    await delay(command.durationMs);
  } finally {
    await transport.close();
  }
}

function parseOptions(argv: string[]): Record<string, string | undefined> {
  const options: Record<string, string | undefined> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = "true";
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function required(options: Record<string, string | undefined>, key: string): string {
  const value = options[key];
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function numberOption(options: Record<string, string | undefined>, key: string, fallback?: number): number {
  const raw = options[key];
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing --${key}`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a finite number`);
  return value;
}

function booleanOption(options: Record<string, string | undefined>, key: string): boolean {
  const raw = options[key];
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`--${key} must be true or false`);
}

function parsePointPairs(raw: string): Array<{ raw: number; expected: number }> {
  return raw.split(",").map((pair) => {
    const [rawValue, expectedValue] = pair.split(":").map(Number);
    if (!Number.isFinite(rawValue) || !Number.isFinite(expectedValue)) throw new Error("--points must use raw:expected pairs separated by commas");
    return { raw: rawValue, expected: expectedValue };
  });
}

function parseAnalogUnit(value: string): AnalogUnit {
  const units = new Set<AnalogUnit>(["raw", "volts", "millivolts", "microvolts", "ohms", "celsius", "lux", "custom"]);
  if (!units.has(value as AnalogUnit)) throw new Error(`Unknown analog unit: ${value}`);
  return value as AnalogUnit;
}

function readCalibrationProfile(path: string): CalibrationProfile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as CalibrationProfile;
  validateCalibrationProfile(parsed);
  return parsed;
}

function writeJson(path: string | undefined, value: unknown, writeLine: (line: string) => void): void {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (path) writeFileSync(path, json, "utf8");
  else writeLine(json.trimEnd());
}

function systemPingFrame(): SerialFrame {
  return {
    channel: "system",
    type: "system.ping",
    timestamp: new Date().toISOString(),
    value: { status: "ping" }
  };
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

function usage(command?: string): string {
  const prefix = command ? `Unknown command: ${command}\n` : "";
  return `${prefix}Usage:
  exocortex-hardware config
  exocortex-hardware calibration-template --output head-calibration.json
  exocortex-hardware calibration-validate --profile head-calibration.json
  exocortex-hardware calibration-derive-linear --profile head-calibration.json --channel battery_voltage --input-unit raw --output-unit volts --points 0:0,2048:3.3
  exocortex-hardware calibration-apply-sample --profile head-calibration.json --channel battery_voltage --raw 2048 --value 2048 --unit raw --sample-count 8
  exocortex-hardware listen --port /dev/cu.usbserial --baud 115200
  exocortex-hardware inspect --port /dev/cu.usbserial --duration-ms 2000
  exocortex-hardware ping --port /dev/cu.usbserial
  exocortex-hardware actuate --port /dev/cu.usbserial --channel headlamp_pwm --enabled true --duty 0.25`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHardwareCli(parseHardwareCliArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
