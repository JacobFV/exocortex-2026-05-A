import assert from "node:assert/strict";
import { createId } from "@exocortex/protocol";
import { BrowserSessionManager } from "./browser-session-manager.js";

const manager = new BrowserSessionManager();
const session = await manager.create(createId<"ModalityInstanceId">("mod"));
const events: string[] = [];
manager.subscribe((event) => events.push(event.type));

await manager.start(session.id);
const frame = await manager.dispatch(session.id, { type: "navigate", url: "https://example.com" });

assert.equal(manager.list()[0]?.state, "running");
assert.equal(manager.list()[0]?.currentUrl, "https://example.com");
assert.equal(frame?.mimeType, "image/svg+xml");
assert.ok(frame?.data.startsWith("data:image/svg+xml;base64,"));
assert.ok(events.includes("state_changed"));
assert.ok(events.includes("action"));
assert.ok(events.includes("projection_frame"));

await manager.stop(session.id);
assert.equal(manager.list()[0]?.state, "stopped");
