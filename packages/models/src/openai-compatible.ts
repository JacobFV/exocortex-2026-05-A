import type { ChatModel, ChatRequest, ChatStreamEvent, ModelConfig, ModelHealth } from "./types.js";
import { parseJsonObject, streamUtf8Lines } from "./stream-utils.js";

export class OpenAICompatibleChatModel implements ChatModel {
  readonly provider = "openai_compatible";
  readonly id: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(config: ModelConfig) {
    this.id = config.id;
    this.model = config.model ?? "gpt-4o-mini";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.apiKey = config.apiKey ?? (config.apiKeyEnv ? process.env[config.apiKeyEnv] : process.env.OPENAI_API_KEY);
  }

  async health(): Promise<ModelHealth> {
    if (!this.apiKey) {
      return {
        id: this.id,
        provider: this.provider,
        status: "configuration_error",
        message: `Missing API key for ${this.id}. Set the configured apiKeyEnv or OPENAI_API_KEY.`,
        model: this.model,
        baseUrl: this.baseUrl
      };
    }
    return {
      id: this.id,
      provider: this.provider,
      status: "configured",
      message: "API key is configured. Live availability is verified when a stream request is made.",
      model: this.model,
      baseUrl: this.baseUrl
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    if (!this.apiKey) throw new Error(`Missing API key for model ${this.id}`);
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          name: message.name,
          tool_call_id: message.toolCallId
        })),
        tools: request.tools?.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        }))
      }),
      signal: request.signal
    });
    if (!response.ok) throw new Error(`Model ${this.id} request failed: ${response.status} ${redactSecrets(await response.text())}`);
    const toolCalls = new Map<number, StreamingToolCall>();
    let usage: Record<string, unknown> | undefined;
    for await (const line of streamUtf8Lines(response.body)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (data === "[DONE]") break;
      const payload = JSON.parse(data) as OpenAIChatCompletionChunk;
      if (payload.usage) usage = payload.usage;
      for (const choice of payload.choices) {
        const delta = choice.delta;
        if (delta.content) yield { type: "text_delta", text: delta.content };
        for (const call of delta.tool_calls ?? []) {
          const existing = toolCalls.get(call.index) ?? { id: "", name: "", argumentsText: "" };
          if (call.id) existing.id = call.id;
          if (call.function?.name) existing.name += call.function.name;
          if (call.function?.arguments) existing.argumentsText += call.function.arguments;
          toolCalls.set(call.index, existing);
        }
      }
    }
    for (const call of [...toolCalls.values()].filter((candidate) => candidate.id && candidate.name)) {
      yield {
        type: "tool_call",
        toolCall: {
          id: call.id,
          name: call.name,
          arguments: parseJsonObject(call.argumentsText)
        }
      };
    }
    yield { type: "done", usage };
  }
}

function redactSecrets(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]+/g, "sk-REDACTED");
}

interface OpenAIChatCompletionChunk {
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: Record<string, unknown>;
}

interface StreamingToolCall {
  id: string;
  name: string;
  argumentsText: string;
}
