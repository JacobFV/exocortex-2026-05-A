import assert from "node:assert/strict";
import { OpenAICompatibleChatModel } from "./openai-compatible.js";
import { ModelRouter } from "./model-router.js";
import { streamUtf8Lines } from "./stream-utils.js";
import { redactLiveSmokeError, runLiveModelSmoke } from "./live-smoke.js";

const router = new ModelRouter([{ id: "local", provider: "local_rules" }]);
assert.deepEqual(router.list(), [{ id: "local", provider: "local_rules" }]);
assert.deepEqual(await router.health("local"), [
  {
    id: "local",
    provider: "local_rules",
    status: "available",
    message: "Deterministic local rules model is available."
  }
]);

let text = "";
for await (const event of router.get("local").stream({ messages: [{ role: "user", content: "browser please" }] })) {
  if (event.type === "text_delta") text += event.text;
}
assert.match(text, /browser sessions/);

const encoded = new TextEncoder().encode("data: one\n\ndata: two\n");
const lines: string[] = [];
for await (const line of streamUtf8Lines(new ReadableStream({ start(controller) {
  controller.enqueue(encoded.slice(0, 8));
  controller.enqueue(encoded.slice(8));
  controller.close();
} }))) {
  lines.push(line);
}
assert.deepEqual(lines, ["data: one", "data: two"]);

const missingKeyRouter = new ModelRouter([
  { id: "missing-key", provider: "openai_compatible", apiKeyEnv: "EXOCORTEX_TEST_MISSING_OPENAI_KEY" }
]);
assert.equal((await missingKeyRouter.health("missing-key"))[0]?.status, "configuration_error");

const llamaRouter = new ModelRouter([
  { id: "llama", provider: "llama_cpp_cli", command: "llama-cli", args: ["--version"] }
]);
assert.equal((await llamaRouter.health("llama"))[0]?.status, "configured");

const smokeRouter = new ModelRouter([{ id: "local", provider: "local_rules" }]);
const smokeResult = await runLiveModelSmoke(smokeRouter, { modelId: "local", requireOptIn: false, prompt: "hello" });
assert.equal(smokeResult.ok, true);
assert.equal(smokeResult.modelId, "local");
assert.match(redactLiveSmokeError("Authorization: Bearer sk-demo and api_key=sk-other"), /REDACTED/);
assert.doesNotMatch(redactLiveSmokeError("Authorization: Bearer sk-demo and api_key=sk-other"), /sk-demo|sk-other/);

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"error":{"message":"Incorrect API key provided: sk-secret"}}', { status: 401 });
  try {
    const model = new OpenAICompatibleChatModel({ id: "redaction", provider: "openai_compatible", apiKey: "sk-secret" });
    await assert.rejects(
      async () => {
        for await (const _event of model.stream({ messages: [{ role: "user", content: "test" }] })) {
          // consume
        }
      },
      /sk-REDACTED/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
