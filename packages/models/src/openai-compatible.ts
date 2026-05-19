import type { ChatModel, ChatRequest, ChatStreamEvent, ModelConfig } from "./types.js";

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
        stream: false,
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
    if (!response.ok) throw new Error(`Model ${this.id} request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as OpenAIChatCompletion;
    const message = payload.choices[0]?.message;
    if (message?.content) yield { type: "text_delta", text: message.content };
    for (const call of message?.tool_calls ?? []) {
      yield {
        type: "tool_call",
        toolCall: {
          id: call.id,
          name: call.function.name,
          arguments: parseJsonObject(call.function.arguments)
        }
      };
    }
    yield { type: "done", usage: payload.usage };
  }
}

interface OpenAIChatCompletion {
  choices: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: Record<string, unknown>;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
