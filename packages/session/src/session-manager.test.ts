import assert from "node:assert/strict";
import { AgentSessionManager } from "./session-manager.js";

const manager = new AgentSessionManager();
const sessionA = manager.create({ goal: "Track browser task" });
const sessionB = manager.create({ goal: "Listen to external microphone" });

assert.equal(manager.list().length, 2);
assert.notEqual(sessionA.id, sessionB.id);

await manager.start(sessionA.id);
const finalSessionA = manager.get(sessionA.id);

assert.equal(finalSessionA?.state, "finished");
assert.ok(manager.events(sessionA.id).some((event) => event.type === "message.completed"));
assert.equal(manager.get(sessionB.id)?.state, "idle");
