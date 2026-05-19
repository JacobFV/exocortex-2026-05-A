import type { ChatModel, ChatRequest, ChatStreamEvent } from "./types.js";

export class LocalRulesModel implements ChatModel {
  readonly provider = "local_rules";

  constructor(readonly id = "local-rules") {}

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const last = [...request.messages].reverse().find((message) => message.role === "user");
    const text = last?.content ?? "";
    const response = this.respond(text);
    for (const chunk of chunkText(response, 32)) {
      if (request.signal?.aborted) return;
      yield { type: "text_delta", text: chunk };
    }
    yield { type: "done" };
  }

  private respond(text: string): string {
    const normalized = text.toLowerCase();
    if (normalized.includes("browser")) {
      return "I can manage browser sessions through the bound browser projection and control modalities.";
    }
    if (normalized.includes("mic") || normalized.includes("speech") || normalized.includes("stt")) {
      return "I recorded that speech-derived text as a sourced modality observation and will keep the source distinct.";
    }
    return `Observed and incorporated: ${text}`;
  }
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}
