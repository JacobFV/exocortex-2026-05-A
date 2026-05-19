import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import type {
  AudioCaptureProvider,
  CapturedMedia,
  ImageCaptureProvider,
  MediaCaptureOptions,
  VideoCaptureProvider
} from "./types.js";

export interface LocalCommandCaptureConfig {
  id: string;
  command: string;
  args?: string[];
  mimeType: string;
  outputExtension?: string;
  appendOutputPath?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

interface CommandTemplateValues {
  output: string;
  durationMs?: number;
  durationSeconds?: string;
  deviceId?: string;
}

class LocalCommandCaptureRunner {
  readonly id: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly mimeType: string;
  private readonly outputExtension: string;
  private readonly appendOutputPath: boolean;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly cwd?: string;

  constructor(config: LocalCommandCaptureConfig) {
    this.id = config.id;
    this.command = config.command;
    this.args = config.args ?? [];
    this.mimeType = config.mimeType;
    this.outputExtension = config.outputExtension ?? extensionFromMimeType(config.mimeType);
    this.appendOutputPath = config.appendOutputPath ?? !this.args.some((arg) => arg.includes("{output}"));
    this.env = config.env;
    this.cwd = config.cwd;
  }

  async capture(kind: "image" | "audio" | "video", options: MediaCaptureOptions = {}, signal?: AbortSignal): Promise<CapturedMedia> {
    const output = options.outputPath ?? this.createOutputPath(kind);
    mkdirSync(dirname(output), { recursive: true });
    const values: CommandTemplateValues = {
      output,
      durationMs: options.durationMs,
      durationSeconds: options.durationMs === undefined ? undefined : (options.durationMs / 1000).toString(),
      deviceId: options.deviceId
    };
    const args = this.args.map((arg) => renderTemplate(arg, values));
    if (this.appendOutputPath) args.push(output);
    await run(this.command, args, { cwd: this.cwd, env: this.env, signal });
    return {
      data: readFileSync(output),
      filePath: output,
      filename: basename(output),
      mimeType: this.mimeType,
      capturedAt: new Date().toISOString(),
      durationMs: options.durationMs,
      metadata: {
        command: this.command,
        kind,
        ...(options.deviceId ? { deviceId: options.deviceId } : {}),
        ...(options.metadata ?? {})
      }
    };
  }

  private createOutputPath(kind: "image" | "audio" | "video"): string {
    const dir = mkdtempSync(join(tmpdir(), `exocortex-${kind}-capture-`));
    return join(dir, `capture.${this.outputExtension}`);
  }
}

export class LocalCommandImageCaptureProvider implements ImageCaptureProvider {
  private readonly runner: LocalCommandCaptureRunner;
  readonly id: string;

  constructor(config: LocalCommandCaptureConfig) {
    this.runner = new LocalCommandCaptureRunner(config);
    this.id = this.runner.id;
  }

  captureImage(options?: MediaCaptureOptions, signal?: AbortSignal): Promise<CapturedMedia> {
    return this.runner.capture("image", options, signal);
  }
}

export class LocalCommandAudioCaptureProvider implements AudioCaptureProvider {
  private readonly runner: LocalCommandCaptureRunner;
  readonly id: string;

  constructor(config: LocalCommandCaptureConfig) {
    this.runner = new LocalCommandCaptureRunner(config);
    this.id = this.runner.id;
  }

  captureAudio(options?: MediaCaptureOptions, signal?: AbortSignal): Promise<CapturedMedia> {
    return this.runner.capture("audio", options, signal);
  }
}

export class LocalCommandVideoCaptureProvider implements VideoCaptureProvider {
  private readonly runner: LocalCommandCaptureRunner;
  readonly id: string;

  constructor(config: LocalCommandCaptureConfig) {
    this.runner = new LocalCommandCaptureRunner(config);
    this.id = this.runner.id;
  }

  captureVideo(options?: MediaCaptureOptions, signal?: AbortSignal): Promise<CapturedMedia> {
    return this.runner.capture("video", options, signal);
  }
}

export function localCommandCaptureConfigFromEnv(kind: "image" | "audio" | "video", env: NodeJS.ProcessEnv = process.env): LocalCommandCaptureConfig | undefined {
  const prefix = `EXOCORTEX_${kind.toUpperCase()}_CAPTURE`;
  const command = env[`${prefix}_COMMAND`];
  if (!command) return undefined;
  return {
    id: env[`${prefix}_PROVIDER`] ?? `local-command-${kind}`,
    command,
    args: parseCommandArgs(env[`${prefix}_ARGS`]),
    mimeType: env[`${prefix}_MIME_TYPE`] ?? defaultMimeType(kind),
    outputExtension: env[`${prefix}_EXTENSION`],
    appendOutputPath: env[`${prefix}_APPEND_OUTPUT`] === undefined ? undefined : env[`${prefix}_APPEND_OUTPUT`] !== "false"
  };
}

function renderTemplate(value: string, values: CommandTemplateValues): string {
  return value
    .replaceAll("{output}", values.output)
    .replaceAll("{durationMs}", values.durationMs?.toString() ?? "")
    .replaceAll("{durationSeconds}", values.durationSeconds ?? "")
    .replaceAll("{deviceId}", values.deviceId ?? "");
}

function parseCommandArgs(value: string | undefined): string[] {
  if (!value) return [];
  return JSON.parse(value) as string[];
}

function defaultMimeType(kind: "image" | "audio" | "video"): string {
  if (kind === "image") return "image/png";
  if (kind === "audio") return "audio/wav";
  return "video/mp4";
}

function extensionFromMimeType(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0];
  if (!subtype) return "bin";
  if (subtype === "jpeg") return "jpg";
  if (subtype === "x-aiff") return "aiff";
  return subtype.replace(/[^a-z0-9]/gi, "") || "bin";
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["ignore", "ignore", "pipe"]
    });
    options.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}
