import { LlamaCppCliChatModel } from "./llama-cpp-cli.js";
import { LocalRulesModel } from "./local-rules.js";
import { OllamaChatModel } from "./ollama.js";
import { OpenAICompatibleChatModel } from "./openai-compatible.js";
import type { ChatModel, ModelConfig } from "./types.js";

export class ModelRouter {
  private readonly models = new Map<string, ChatModel>();
  private defaultModelId: string;

  constructor(configs: ModelConfig[] = defaultModelConfigs()) {
    if (!configs.length) throw new Error("ModelRouter requires at least one model config");
    for (const config of configs) {
      this.register(createModel(config));
    }
    this.defaultModelId = configs[0]!.id;
  }

  register(model: ChatModel): void {
    this.models.set(model.id, model);
  }

  setDefault(id: string): void {
    this.get(id);
    this.defaultModelId = id;
  }

  get(id = this.defaultModelId): ChatModel {
    const model = this.models.get(id);
    if (!model) throw new Error(`Unknown model: ${id}`);
    return model;
  }

  list(): Array<{ id: string; provider: ChatModel["provider"] }> {
    return [...this.models.values()].map((model) => ({ id: model.id, provider: model.provider }));
  }
}

export function createModel(config: ModelConfig): ChatModel {
  switch (config.provider) {
    case "openai_compatible":
      return new OpenAICompatibleChatModel(config);
    case "ollama":
      return new OllamaChatModel(config);
    case "llama_cpp_cli":
      return new LlamaCppCliChatModel(config);
    case "local_rules":
      return new LocalRulesModel(config.id);
  }
}

export function defaultModelConfigs(): ModelConfig[] {
  return [
    { id: "local-rules", provider: "local_rules" },
    { id: "ollama-default", provider: "ollama", model: process.env.EXOCORTEX_OLLAMA_MODEL ?? "llama3.2" },
    {
      id: "openai-compatible",
      provider: "openai_compatible",
      model: process.env.EXOCORTEX_OPENAI_MODEL ?? "gpt-4o-mini",
      baseUrl: process.env.EXOCORTEX_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY"
    }
  ];
}
