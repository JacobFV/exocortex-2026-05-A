import type { ChatModel, ChatRequest, ChatStreamEvent, ModelConfig } from "./types.js";

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

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: request.messages.map((message) => ({
          role: message.role === "tool" ? "user" : message.role,
          content: message.content
        }))
      }),
      signal: request.signal
    });
    if (!response.ok) throw new Error(`Ollama model ${this.id} request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as { message?: { content?: string } };
    if (payload.message?.content) yield { type: "text_delta", text: payload.message.content };
    yield { type: "done" };
  }
}
