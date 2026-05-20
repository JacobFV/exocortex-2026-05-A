import { LlamaCppCliChatModel } from "./llama-cpp-cli.js";
import { LocalRulesModel } from "./local-rules.js";
import { OllamaChatModel } from "./ollama.js";
import { OpenAICompatibleChatModel } from "./openai-compatible.js";
import type { ChatModel, ModelConfig, ModelHealth } from "./types.js";

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

  async health(id?: string): Promise<ModelHealth[]> {
    const models = id ? [this.get(id)] : [...this.models.values()];
    return Promise.all(
      models.map(async (model) => {
        if (model.health) return model.health();
        return {
          id: model.id,
          provider: model.provider,
          status: "configured",
          message: "Model does not expose an active health check."
        };
      })
    );
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
  const configs: ModelConfig[] = [
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
  if (process.env.EXOCORTEX_LLAMA_CPP_COMMAND) {
    configs.push({
      id: "llama-cpp-cli",
      provider: "llama_cpp_cli",
      command: process.env.EXOCORTEX_LLAMA_CPP_COMMAND,
      args: process.env.EXOCORTEX_LLAMA_CPP_ARGS ? JSON.parse(process.env.EXOCORTEX_LLAMA_CPP_ARGS) as string[] : []
    });
  }
  return configs;
}
