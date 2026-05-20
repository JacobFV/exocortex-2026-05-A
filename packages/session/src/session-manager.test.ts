import assert from "node:assert/strict";
import { BrowserSessionManager, type BrowserController } from "@exocortex/browser-session";
import { EventGraphCapabilityRegistry, EventGraphKernel, EventSourcedGraph, InMemoryEventSourcedGraphStore } from "@exocortex/continuity";
import type { ChatModel, ChatRequest, ChatStreamEvent } from "@exocortex/models";
import { ModalityRegistry } from "@exocortex/modalities";
import { ModelRouter } from "@exocortex/models";
import { ModelDrivenAgentRuntime, type AgentRuntimeContext } from "./agent-runtime.js";
import { createBrowserAgentTools } from "./browser-tools.js";
import { ModalityActionRouter, type ModalityActionSink } from "./modality-action-router.js";
import { AgentSessionManager } from "./session-manager.js";
import { AgentToolRouter } from "./tool-router.js";

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
assert.equal(sessionA.continuityRunId, "main");

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

class ToolCallingModel implements ChatModel {
  readonly id = "tool-model";
  readonly provider = "local_rules";

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    if (request.messages.some((message) => message.role === "tool")) {
      yield { type: "text_delta", text: "Tool result incorporated." };
      yield { type: "done" };
      return;
    }
    assert.ok(request.tools?.some((tool) => tool.name === "record_context"));
    yield { type: "tool_call", toolCall: { id: "model_tool_1", name: "record_context", arguments: { value: "browser" } } };
    yield { type: "done" };
  }
}

const modelRouter = new ModelRouter([{ id: "local", provider: "local_rules" }]);
modelRouter.register(new ToolCallingModel());
modelRouter.setDefault("tool-model");
const toolRouter = new AgentToolRouter([
  {
    definition: {
      name: "record_context",
      description: "Record a structured context value.",
      parameters: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"]
      }
    },
    execute(input) {
      return { output: { recorded: input.value } };
    }
  }
]);
const toolSessionManager = new AgentSessionManager({
  runtime: new ModelDrivenAgentRuntime({ models: modelRouter, tools: toolRouter })
});
const toolSession = toolSessionManager.create({ goal: "Use tools", runtime: { provider: "local", model: "tool-model", driver: "model-driven-agent-runtime" } });
const toolBinding = registry.bindToSession({ sessionId: toolSession.id, modalityInstanceId: modalityInstances[0]!.id });
toolSessionManager.bindModality(toolSession.id, toolBinding);
await toolSessionManager.start(toolSession.id);
toolSessionManager.observe(toolSession.id, toolBinding.id, "text.final", { text: "run tool" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(toolSessionManager.events(toolSession.id).some((event) => event.type === "tool_call.completed" && (event.output as { recorded?: unknown }).recorded === "browser"));
assert.ok(toolSessionManager.events(toolSession.id).some((event) => event.type === "message.completed" && event.text === "Tool result incorporated."));
toolSessionManager.stop(toolSession.id);

class CapabilityAwareModel implements ChatModel {
  readonly id = "capability-model";
  readonly provider = "local_rules";
  seenToolNames: string[][] = [];

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const names = request.tools?.map((tool) => tool.name) ?? [];
    this.seenToolNames.push(names);
    yield { type: "tool_call", toolCall: { id: `capability_call_${this.seenToolNames.length}`, name: "record_context", arguments: { value: "capability" } } };
    yield { type: "done" };
  }
}

const capabilityGraph = new EventSourcedGraph({ runId: "capability_test", store: new InMemoryEventSourcedGraphStore() });
const capabilityRegistry = new EventGraphCapabilityRegistry(capabilityGraph);
capabilityRegistry.register({
  kind: "tool",
  key: "record_context",
  provider: "@exocortex/session",
  definition: toolRouter.definitions()[0]
});
const capabilityModel = new CapabilityAwareModel();
const capabilityModelRouter = new ModelRouter([{ id: "local", provider: "local_rules" }]);
capabilityModelRouter.register(capabilityModel);
capabilityModelRouter.setDefault("capability-model");
const capabilityManager = new AgentSessionManager({
  runtime: new ModelDrivenAgentRuntime({ models: capabilityModelRouter, tools: toolRouter, capabilities: capabilityRegistry, maxToolRounds: 1 })
});
const capabilitySession = capabilityManager.create({ goal: "Filter tools", runtime: { provider: "local", model: "capability-model", driver: "model-driven-agent-runtime" } });
const capabilityBinding = registry.bindToSession({ sessionId: capabilitySession.id, modalityInstanceId: modalityInstances[0]!.id });
capabilityManager.bindModality(capabilitySession.id, capabilityBinding);
await capabilityManager.start(capabilitySession.id);
capabilityManager.observe(capabilitySession.id, capabilityBinding.id, "text.final", { text: "tool allowed" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(capabilityModel.seenToolNames[0], ["record_context"]);
assert.ok(capabilityManager.events(capabilitySession.id).some((event) => event.type === "tool_call.completed"));
assert.ok(capabilityManager.events(capabilitySession.id).some((event) => event.type === "tool_call.started" && event.metadata?.capabilitySetHash));
assert.ok(capabilityManager.events(capabilitySession.id).some((event) => event.type === "tool_call.started" && event.metadata?.promptHash && event.metadata?.policyHash));
capabilityRegistry.setEnabled("tool", "record_context", false);
capabilityManager.observe(capabilitySession.id, capabilityBinding.id, "text.final", { text: "tool blocked" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(capabilityModel.seenToolNames[1], []);
assert.ok(capabilityManager.events(capabilitySession.id).some((event) => event.type === "tool_call.failed" && event.message.includes("not enabled")));
capabilityManager.stop(capabilitySession.id);

const browserActions: unknown[] = [];
const browserController: BrowserController = {
  async start() {},
  async stop() {},
  async dispatch(_session, action) {
    browserActions.push(action);
  },
  async captureFrame(session) {
    return {
      browserSessionId: session.id,
      modalityInstanceId: session.modalityInstanceId,
      width: 800,
      height: 600,
      mimeType: "image/png",
      data: "frame",
      capturedAt: "2026-05-19T00:00:00.000Z"
    };
  }
};
const browserManager = new BrowserSessionManager(browserController);
const browserDevice = registry.createDeviceInstance({ typeKey: "browser_session", key: "test_browser", transport: "ipc" });
const browserModality = registry.createModalityInstance({ typeKey: "browser_projected_screen", deviceId: browserDevice.id, source: "browser_session", transport: "ipc" });
const browserTools = createBrowserAgentTools({
  manager: browserManager,
  createSession: async () => {
    const browserSession = await browserManager.create(browserModality.id);
    return browserManager.start(browserSession.id);
  }
});
const browserToolContext: AgentRuntimeContext = {
  session: toolSession,
  signal: new AbortController().signal,
  emit(event) {
    return toolSessionManager.events(toolSession.id).find((candidate) => candidate.type === event.type) ?? toolSessionManager.observe(toolSession.id, toolBinding.id, "test", {});
  }
};
const created = await browserTools.find((tool) => tool.definition.name === "browser_create_session")!.execute({}, browserToolContext, {
  id: "call",
  name: "browser_create_session",
  arguments: {}
});
assert.equal((created.output as { state?: string }).state, "running");
const navigate = await browserTools.find((tool) => tool.definition.name === "browser_navigate")!.execute({ url: "https://example.com" }, browserToolContext, {
  id: "call",
  name: "browser_navigate",
  arguments: { url: "https://example.com" }
});
assert.deepEqual(browserActions[0], { type: "navigate", url: "https://example.com" });
assert.equal((navigate.output as { frame?: { width?: number } }).frame?.width, 800);

const continuityGraph = new EventSourcedGraph({ runId: "session_projection", store: new InMemoryEventSourcedGraphStore() });
const eventGraphKernel = new EventGraphKernel({ graph: continuityGraph });
const continuityManager = new AgentSessionManager({ eventGraphKernel });
const continuitySession = continuityManager.create({ goal: "Project into graph", continuityRunId: "main" });
assert.ok(continuityGraph.findObjects({ type: "agent_session", where: { sessionId: continuitySession.id } }).length);
assert.ok(continuityGraph.findObjects({ type: "goal", where: { sessionId: continuitySession.id } }).length);
const continuityBinding = registry.bindToSession({ sessionId: continuitySession.id, modalityInstanceId: modalityInstances[0]!.id });
continuityManager.bindModality(continuitySession.id, continuityBinding);
continuityManager.observe(continuitySession.id, continuityBinding.id, "text.final", { text: "continuity evidence" });
assert.ok(continuityGraph.findObjects({ type: "evidence" }).some((node) => node.data.valueHash));
eventGraphKernel.close();
