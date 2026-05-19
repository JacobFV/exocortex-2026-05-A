import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { AudioInput, SpeechOutput, STTProvider, TranscriptResult, TTSProvider } from "./types.js";

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
