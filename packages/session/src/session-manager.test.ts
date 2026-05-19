import assert from "node:assert/strict";
import { ModalityRegistry } from "@exocortex/peripherals";
import { ModalityActionRouter, type ModalityActionSink } from "./modality-action-router.js";
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

const actionManager = new AgentSessionManager();
const actionRouter = new ModalityActionRouter(actionManager);
const actionSession = actionManager.create({ goal: "Actuate" });
const outputBinding = registry.bindToSession({ sessionId: actionSession.id, modalityInstanceId: modalityInstances[0]!.id });
actionManager.bindModality(actionSession.id, outputBinding);
const sent: Array<{ actionType: string; value: unknown }> = [];
const sink: ModalityActionSink = {
  async send(actionType, value) {
    sent.push({ actionType, value });
  }
};
actionRouter.bindSession(actionManager.listBindings(actionSession.id));
actionRouter.registerSink(outputBinding.modalityInstanceId, sink);
actionRouter.start();
actionManager.act(actionSession.id, outputBinding.id, "actuator.command", { enabled: true });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(sent, [{ actionType: "actuator.command", value: { enabled: true } }]);
actionRouter.stop();
