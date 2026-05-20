import assert from "node:assert/strict";
import { ModelRouter } from "./model-router.js";
import { streamUtf8Lines } from "./stream-utils.js";

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
