import assert from "node:assert/strict";
import { ModalityRegistry } from "@exocortex/peripherals";
import { AgentSessionManager } from "./session-manager.js";

const registry = new ModalityRegistry();
const modalityInstances = registry.createDefaultHostGraph();
const manager = new AgentSessionManager();
const observedEvents: string[] = [];
manager.subscribe("*", (event) => observedEvents.push(event.type));
const sessionA = manager.create({ goal: "Track browser task" });
for (const modality of modalityInstances) {
  manager.bindModality(sessionA.id, registry.bindToSession({ sessionId: sessionA.id, modalityInstanceId: modality.id }));
}
const sessionB = manager.create({ goal: "Listen to external microphone" });

assert.equal(manager.list().length, 2);
assert.notEqual(sessionA.id, sessionB.id);

await manager.start(sessionA.id);
const runningSessionA = manager.get(sessionA.id);

assert.equal(runningSessionA?.state, "running");
assert.ok(manager.events(sessionA.id).some((event) => event.type === "message.completed"));
assert.equal(manager.get(sessionB.id)?.state, "idle");

const appInput = manager.listBindings(sessionA.id).find((binding) => binding.key === "app_input_text");
assert.ok(appInput);
manager.observe(sessionA.id, appInput.id, "text.final", { text: "hello" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(manager.events(sessionA.id).some((event) => event.type === "message.completed" && event.text.includes("hello")));
assert.ok(observedEvents.includes("modality.observation"));

const artifact = manager.createArtifact({
  sessionId: sessionA.id,
  kind: "text",
  title: "Observation summary",
  value: { text: "hello" }
});
assert.equal(manager.artifacts(sessionA.id)[0]?.id, artifact.id);
assert.ok(manager.events(sessionA.id).some((event) => event.type === "artifact.created"));

manager.stop(sessionA.id);
assert.equal(manager.get(sessionA.id)?.state, "stopped");
