import assert from "node:assert/strict";
import { ModelRouter } from "./model-router.js";
import { streamUtf8Lines } from "./stream-utils.js";

const router = new ModelRouter([{ id: "local", provider: "local_rules" }]);
assert.deepEqual(router.list(), [{ id: "local", provider: "local_rules" }]);

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
