import type { ChatModel, ChatRequest, ChatStreamEvent, ModelConfig, ModelHealth } from "./types.js";
import { streamUtf8Lines } from "./stream-utils.js";

export class OllamaChatModel implements ChatModel {
  readonly provider = "ollama";
  readonly id: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: ModelConfig) {
    this.id = config.id;
    this.model = config.model ?? "llama3.2";
    this.baseUrl = (config.baseUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  }

  async health(): Promise<ModelHealth> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      if (!response.ok) {
        return {
          id: this.id,
          provider: this.provider,
          status: "unavailable",
          message: `Ollama health request failed: ${response.status}`,
          model: this.model,
          baseUrl: this.baseUrl
        };
      }
      return {
        id: this.id,
        provider: this.provider,
        status: "available",
        message: "Ollama service responded.",
        model: this.model,
        baseUrl: this.baseUrl
      };
    } catch (error) {
      return {
        id: this.id,
        provider: this.provider,
        status: "unavailable",
        message: error instanceof Error ? error.message : String(error),
        model: this.model,
        baseUrl: this.baseUrl
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        messages: request.messages.map((message) => ({
          role: message.role === "tool" ? "user" : message.role,
          content: message.content
        }))
      }),
      signal: request.signal
    });
    if (!response.ok) throw new Error(`Ollama model ${this.id} request failed: ${response.status} ${await response.text()}`);
    for await (const line of streamUtf8Lines(response.body)) {
      const payload = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
      if (payload.message?.content) yield { type: "text_delta", text: payload.message.content };
      if (payload.done) break;
    }
    yield { type: "done" };
  }
}
