import assert from "node:assert/strict";
import { ModelRouter } from "./model-router.js";

const router = new ModelRouter([{ id: "local", provider: "local_rules" }]);
assert.deepEqual(router.list(), [{ id: "local", provider: "local_rules" }]);

let text = "";
for await (const event of router.get("local").stream({ messages: [{ role: "user", content: "browser please" }] })) {
  if (event.type === "text_delta") text += event.text;
}
assert.match(text, /browser sessions/);
