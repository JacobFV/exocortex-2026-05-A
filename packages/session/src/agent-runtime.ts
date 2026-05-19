import { createId, type AgentSession, type AgentSessionEvent, type AgentSessionEventPayload } from "@exocortex/protocol";
import { ModelRouter, type ChatMessage } from "@exocortex/models";

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

  constructor(private readonly models = new ModelRouter()) {}

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
    let assistantText = "";
    for await (const event of model.stream({ messages: history, signal: context.signal })) {
      if (event.type === "text_delta") {
        assistantText += event.text;
        context.emit({ type: "message.delta", role: "assistant", text: event.text, modalityId });
      } else if (event.type === "tool_call") {
        const toolCallId = createId<"ToolCallId">("tool");
        context.emit({ type: "tool_call.started", toolCallId, name: event.toolCall.name, input: event.toolCall.arguments, modalityId });
        context.emit({ type: "tool_call.failed", toolCallId, code: "tool_router_unavailable", message: `No tool router is registered for ${event.toolCall.name}`, modalityId });
      }
    }
    if (assistantText) {
      history.push({ role: "assistant", content: assistantText });
      context.emit({ type: "message.completed", role: "assistant", text: assistantText, modalityId });
    }
    this.histories.set(context.session.id, history.slice(-40));
  }

  private selectedModelId(session: AgentSession): string {
    return session.runtime.model ?? "local-rules";
  }
}

export { ModelDrivenAgentRuntime as ContinuousAgentRuntime };

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
