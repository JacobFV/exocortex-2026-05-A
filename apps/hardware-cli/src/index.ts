#!/usr/bin/env node
import { defaultHeadBridgeConfig, validateActuatorCommand, validateHeadBridgeConfig } from "@exocortex/hardware";
import { NodeSerialTransport, type SerialFrame } from "@exocortex/transports";

export type HardwareCliCommand =
  | { name: "config" }
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
