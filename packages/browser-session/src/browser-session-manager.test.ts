import assert from "node:assert/strict";
import { createId } from "@exocortex/protocol";
import { BrowserSessionManager, type BrowserController } from "./browser-session-manager.js";

const controller: BrowserController = {
  async start() {},
  async stop() {},
  async dispatch() {},
  async captureFrame(session) {
    return {
      browserSessionId: session.id,
      modalityInstanceId: session.modalityInstanceId,
      width: 1,
      height: 1,
      mimeType: "image/png",
      data: "data:image/png;base64,",
      capturedAt: new Date().toISOString()
    };
  }
};
const manager = new BrowserSessionManager(controller);
const session = await manager.create(createId<"ModalityInstanceId">("mod"));
const events: string[] = [];
manager.subscribe((event) => events.push(event.type));

await manager.start(session.id);
const frame = await manager.dispatch(session.id, { type: "navigate", url: "https://example.com" });

assert.equal(manager.list()[0]?.state, "running");
assert.equal(manager.list()[0]?.currentUrl, "https://example.com");
assert.equal(frame?.mimeType, "image/png");
assert.ok(frame?.data.startsWith("data:image/png;base64,"));
assert.ok(events.includes("state_changed"));
assert.ok(events.includes("action"));
assert.ok(events.includes("projection_frame"));

await manager.stop(session.id);
assert.equal(manager.list()[0]?.state, "stopped");
