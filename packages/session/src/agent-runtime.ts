import { stableHash, type ContinuityCapabilityRegistry } from "@exocortex/continuity";
import { createId, type AgentSession, type AgentSessionEvent, type AgentSessionEventPayload } from "@exocortex/protocol";
import { ModelRouter, type ChatMessage, type ChatStreamEvent, type ToolCall, type ToolDefinition } from "@exocortex/models";
import { AgentToolRouter } from "./tool-router.js";

export interface AgentRuntimeContext {
  session: AgentSession;
  emit(event: AgentSessionEventPayload): AgentSessionEvent;
  signal: AbortSignal;
}

export interface AgentRuntime {
  readonly runtimeId: string;
  start(context: AgentRuntimeContext): Promise<void>;
  handleObservation?(context: AgentRuntimeContext, event: AgentSessionEvent): Promise<void>;
  handleActionResult?(context: AgentRuntimeContext, event: AgentSessionEvent): Promise<void>;
}

export class ModelDrivenAgentRuntime implements AgentRuntime {
  readonly runtimeId = "model-driven-agent-runtime";
  private readonly histories = new Map<string, ChatMessage[]>();

  constructor(private readonly options: { models?: ModelRouter; tools?: AgentToolRouter; capabilities?: ContinuityCapabilityRegistry; maxToolRounds?: number } = {}) {}

  async start(context: AgentRuntimeContext): Promise<void> {
    this.histories.set(context.session.id, [
      {
        role: "system",
        content: systemPrompt(context.session)
      }
    ]);
    context.emit({
      type: "message.completed",
      role: "assistant",
      text: `Session online. Goal: ${context.session.goal}. Model runtime: ${this.selectedModelId(context.session)}. Bound modalities: ${context.session.modalityBindingIds.length}.`
    });
    await waitForAbort(context.signal);
    this.histories.delete(context.session.id);
  }

  async handleObservation(context: AgentRuntimeContext, event: AgentSessionEvent): Promise<void> {
    if (event.type !== "modality.observation") return;
    const binding = context.session.modalityBindings?.find((candidate) => candidate.id === event.bindingId);
    const text = observationText(event.value);
    if (!text || event.observationType === "text.partial") return;

    context.emit({
      type: "message.completed",
      role: "user",
      text,
      source: binding?.key ?? event.bindingId,
      modalityId: event.bindingId
    });
    await this.runModelTurn(context, `${binding?.key ?? "unknown_modality"}: ${text}`, event.bindingId);
  }

  private async runModelTurn(context: AgentRuntimeContext, userText: string, modalityId: AgentSessionEvent["modalityId"]): Promise<void> {
    const history = this.histories.get(context.session.id) ?? [{ role: "system", content: systemPrompt(context.session) }];
    history.push({ role: "user", content: userText });

    const model = this.models.get(this.selectedModelId(context.session));
    for (let round = 0; round < this.maxToolRounds; round += 1) {
      const result = await this.runSingleModelPass(context, history, modalityId);
      if (result.assistantText) history.push({ role: "assistant", content: result.assistantText });
      for (const output of result.toolOutputs) history.push({ role: "tool", content: JSON.stringify(output.output), toolCallId: output.toolCallId, name: output.name });
      if (!result.toolOutputs.length) break;
      if (round === this.maxToolRounds - 1) {
        context.emit({
          type: "session.error",
          code: "tool_round_limit",
          message: `Stopped tool execution after ${this.maxToolRounds} model-tool rounds.`,
          recoverable: true,
          modalityId
        });
      }
    }
    this.histories.set(context.session.id, history.slice(-40));
  }

  private async runSingleModelPass(
    context: AgentRuntimeContext,
    history: ChatMessage[],
    modalityId: AgentSessionEvent["modalityId"]
  ): Promise<{ assistantText: string; toolOutputs: Array<{ toolCallId: string; name: string; output: unknown }> }> {
    let assistantText = "";
    const toolOutputs: Array<{ toolCallId: string; name: string; output: unknown }> = [];
    const lineage = this.modelTurnLineage(context.session);
    for await (const event of this.models.get(this.selectedModelId(context.session)).stream({ messages: history, tools: this.toolDefinitionsForSession(context.session), signal: context.signal })) {
      if (event.type === "text_delta") {
        assistantText += event.text;
        context.emit({ type: "message.delta", role: "assistant", text: event.text, modalityId, metadata: lineage });
      } else if (event.type === "tool_call") {
        const output = await this.executeToolCall(context, event.toolCall, modalityId);
        if (output !== undefined) toolOutputs.push({ toolCallId: event.toolCall.id, name: event.toolCall.name, output });
      }
    }
    if (assistantText) {
      context.emit({ type: "message.completed", role: "assistant", text: assistantText, modalityId, metadata: lineage });
    }
    return { assistantText, toolOutputs };
  }

  private async executeToolCall(context: AgentRuntimeContext, call: ToolCall, modalityId: AgentSessionEvent["modalityId"]): Promise<unknown | undefined> {
    const toolCallId = createId<"ToolCallId">("tool");
    const capability = this.toolCapability(context.session, call.name);
    const metadata = { ...this.modelTurnLineage(context.session), capabilityNodeId: capability?.id, capabilityHash: capability?.metadata?.capabilityHash };
    context.emit({ type: "tool_call.started", toolCallId, name: call.name, input: call.arguments, modalityId, metadata });
    try {
      if (this.options.capabilities && !capability) throw new Error(`Tool capability is not enabled for ${call.name}`);
      const result = await this.tools.execute(call, context);
      for (const event of result.emittedEvents ?? []) context.emit({ ...event, modalityId: event.modalityId ?? modalityId });
      context.emit({ type: "tool_call.completed", toolCallId, output: result.output, modalityId, metadata });
      return result.output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.emit({ type: "tool_call.failed", toolCallId, code: "tool_execution_failed", message, modalityId, metadata });
      return undefined;
    }
  }

  private get models(): ModelRouter {
    return this.options.models ?? defaultModelRouter;
  }

  private get tools(): AgentToolRouter {
    return this.options.tools ?? defaultToolRouter;
  }

  private get maxToolRounds(): number {
    return this.options.maxToolRounds ?? 4;
  }

  private toolDefinitionsForSession(session: AgentSession): ToolDefinition[] {
    const definitions = this.tools.definitions();
    if (!this.options.capabilities) return definitions;
    const enabledToolKeys = new Set(this.options.capabilities.listEnabled(session.branchId, "tool").map((node) => String(node.metadata?.key ?? "")));
    return definitions.filter((definition) => enabledToolKeys.has(definition.name));
  }

  private toolCapability(session: AgentSession, name: string) {
    return this.options.capabilities?.listEnabled(session.branchId, "tool").find((node) => node.metadata?.key === name);
  }

  private modelTurnLineage(session: AgentSession): Record<string, unknown> {
    return {
      modelId: this.selectedModelId(session),
      runtimeId: this.runtimeId,
      promptHash: stableHash(systemPrompt(session)),
      policyHash: this.policyHash(session),
      capabilitySetHash: this.options.capabilities?.capabilitySetHash(session.branchId)
    };
  }

  private policyHash(session: AgentSession): string | undefined {
    if (!this.options.capabilities) return undefined;
    return stableHash(
      this.options.capabilities.listEnabled(session.branchId, "policy").map((node) => ({
        stableKey: node.stableKey,
        hash: node.metadata?.capabilityHash
      }))
    );
  }

  private selectedModelId(session: AgentSession): string {
    return session.runtime.model ?? "local-rules";
  }
}

export { ModelDrivenAgentRuntime as ContinuousAgentRuntime };

const defaultModelRouter = new ModelRouter();
const defaultToolRouter = new AgentToolRouter();

function observationText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text?: unknown }).text;
    return typeof text === "string" ? text : undefined;
  }
  return undefined;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function systemPrompt(session: AgentSession): string {
  const modalities = session.modalityBindings
    ?.map((binding) => `${binding.key} (${binding.direction}, ${binding.kind}, ${binding.source}, policy=${binding.policy})`)
    .join("\n") ?? "";
  return `You are the exocortex agent runtime.
Goal: ${session.goal}

Every observation has a source modality. Preserve provenance in reasoning and responses.

Bound modalities:
${modalities}`;
}
