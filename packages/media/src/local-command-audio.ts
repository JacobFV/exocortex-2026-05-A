import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { AudioInput, AudioPlaybackProvider, AudioPlaybackResult, SpeechOutput, STTProvider, TranscriptResult, TTSProvider } from "./types.js";

export class LocalCommandSTTProvider implements STTProvider {
  constructor(readonly id: string, private readonly command: string, private readonly args: string[] = []) {}

  async transcribe(input: AudioInput, signal?: AbortSignal): Promise<TranscriptResult> {
    const dir = mkdtempSync(join(tmpdir(), "exocortex-stt-"));
    const audioPath = join(dir, input.filename ?? "input.wav");
    writeFileSync(audioPath, input.data);
    const stdout = await run(this.command, [...this.args, audioPath], signal);
    return { text: stdout.trim(), metadata: { command: this.command } };
  }
}

export class MacOSSayTTSProvider implements TTSProvider {
  readonly id = "macos-say";

  async synthesize(text: string, signal?: AbortSignal): Promise<SpeechOutput> {
    const dir = mkdtempSync(join(tmpdir(), "exocortex-tts-"));
    const output = join(dir, "speech.aiff");
    await run("say", ["-o", output, text], signal);
    return { filePath: output, mimeType: "audio/aiff", metadata: { command: "say" } };
  }
}

export interface LocalCommandAudioPlaybackConfig {
  id: string;
  command: string;
  args?: string[];
  appendInputPath?: boolean;
}

export class LocalCommandAudioPlaybackProvider implements AudioPlaybackProvider {
  readonly id: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly appendInputPath: boolean;

  constructor(config: LocalCommandAudioPlaybackConfig) {
    this.id = config.id;
    this.command = config.command;
    this.args = config.args ?? [];
    this.appendInputPath = config.appendInputPath ?? !this.args.some((arg) => arg.includes("{input}"));
  }

  async playAudio(input: AudioInput, signal?: AbortSignal): Promise<AudioPlaybackResult> {
    const dir = mkdtempSync(join(tmpdir(), "exocortex-audio-playback-"));
    const inputPath = join(dir, input.filename ?? `input.${extensionFromMimeType(input.mimeType)}`);
    writeFileSync(inputPath, input.data);
    const args = this.args.map((arg) => arg.replaceAll("{input}", inputPath).replaceAll("{mimeType}", input.mimeType));
    if (this.appendInputPath) args.push(inputPath);
    await run(this.command, args, signal);
    return {
      playedAt: new Date().toISOString(),
      metadata: { command: this.command }
    };
  }
}

export function localCommandAudioPlaybackConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LocalCommandAudioPlaybackConfig | undefined {
  const command = env.EXOCORTEX_AUDIO_PLAYBACK_COMMAND;
  if (!command && process.platform !== "darwin") return undefined;
  return {
    id: env.EXOCORTEX_AUDIO_PLAYBACK_PROVIDER ?? (command ? "local-command-audio-playback" : "macos-afplay"),
    command: command ?? "afplay",
    args: env.EXOCORTEX_AUDIO_PLAYBACK_ARGS ? JSON.parse(env.EXOCORTEX_AUDIO_PLAYBACK_ARGS) as string[] : [],
    appendInputPath: env.EXOCORTEX_AUDIO_PLAYBACK_APPEND_INPUT === undefined ? undefined : env.EXOCORTEX_AUDIO_PLAYBACK_APPEND_INPUT !== "false"
  };
}

function extensionFromMimeType(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0];
  if (!subtype) return "bin";
  if (subtype === "mpeg") return "mp3";
  if (subtype === "x-aiff" || subtype === "aiff") return "aiff";
  return subtype.replace(/[^a-z0-9]/gi, "") || "bin";
}

function run(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}
