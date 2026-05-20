import { ModelRouter } from "./model-router.js";
import type { ChatModel, ChatStreamEvent } from "./types.js";

export interface LiveModelSmokeResult {
  modelId: string;
  provider: ChatModel["provider"];
  ok: boolean;
  text: string;
  events: number;
}

export interface LiveModelSmokeOptions {
  modelId?: string;
  prompt?: string;
  timeoutMs?: number;
  requireOptIn?: boolean;
}

export async function runLiveModelSmoke(router = new ModelRouter(), options: LiveModelSmokeOptions = {}): Promise<LiveModelSmokeResult> {
  if (options.requireOptIn !== false && process.env.EXOCORTEX_LIVE_MODEL_CHECK !== "1") {
    throw new Error("Live model smoke checks are disabled. Set EXOCORTEX_LIVE_MODEL_CHECK=1 to run provider calls.");
  }
  const model = router.get(options.modelId ?? process.env.EXOCORTEX_LIVE_MODEL_ID);
  const timeoutMs = options.timeoutMs ?? Number(process.env.EXOCORTEX_LIVE_MODEL_TIMEOUT_MS ?? 30_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("live model smoke timeout"), timeoutMs);
  let text = "";
  let events = 0;
  try {
    for await (const event of model.stream({
      messages: [{ role: "user", content: options.prompt ?? "Reply with the single word: ok" }],
      signal: controller.signal
    })) {
      events += 1;
      if (event.type === "text_delta") text += event.text;
      if (event.type === "done") break;
      consumeToolCall(event);
    }
  } finally {
    clearTimeout(timeout);
  }
  return {
    modelId: model.id,
    provider: model.provider,
    ok: text.trim().length > 0 || events > 0,
    text,
    events
  };
}

export function redactLiveSmokeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/sk-[^"'\s]+/g, "sk-REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer REDACTED")
    .replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9._~+/=-]+/gi, "$1REDACTED");
}

function consumeToolCall(event: ChatStreamEvent): void {
  if (event.type === "tool_call") return;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLiveModelSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(redactLiveSmokeError(error));
      process.exitCode = 1;
    });
}
