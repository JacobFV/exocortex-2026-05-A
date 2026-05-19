export type ModelProviderKind = "openai_compatible" | "ollama" | "llama_cpp_cli" | "local_rules";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export type ChatStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "done"; usage?: Record<string, unknown> };

export interface ChatModel {
  readonly id: string;
  readonly provider: ModelProviderKind;
  stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

export interface ModelConfig {
  id: string;
  provider: ModelProviderKind;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  command?: string;
  args?: string[];
  systemPrompt?: string;
}
