import { spawn } from "node:child_process";
import type { ChatModel, ChatRequest, ChatStreamEvent, ModelConfig } from "./types.js";

export class LlamaCppCliChatModel implements ChatModel {
  readonly provider = "llama_cpp_cli";
  readonly id: string;
  private readonly command: string;
  private readonly args: string[];

  constructor(config: ModelConfig) {
    this.id = config.id;
    if (!config.command) throw new Error("llama_cpp_cli model requires command");
    this.command = config.command;
    this.args = config.args ?? [];
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const prompt = request.messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n");
    const child = spawn(this.command, this.args, { stdio: ["pipe", "pipe", "pipe"] });
    request.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    child.stdin.end(prompt);

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    for await (const chunk of child.stdout) {
      if (request.signal?.aborted) return;
      yield { type: "text_delta", text: chunk.toString() };
    }

    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    if (code !== 0) throw new Error(`llama.cpp CLI exited with ${code}: ${stderr.trim()}`);
    yield { type: "done" };
  }
}
