import type { AgentSession, AgentSessionEvent, AgentSessionEventPayload } from "@exocortex/protocol";

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

export class ContinuousAgentRuntime implements AgentRuntime {
  readonly runtimeId = "continuous-local-agent-runtime";

  async start(context: AgentRuntimeContext): Promise<void> {
    context.emit({
      type: "message.completed",
      role: "assistant",
      text: `Session online. Goal: ${context.session.goal}. Bound modalities: ${context.session.modalityBindingIds.length}.`
    });
    await waitForAbort(context.signal);
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
    context.emit({
      type: "message.completed",
      role: "assistant",
      text: `Perceived ${binding?.key ?? "modality"}: ${text}`,
      modalityId: event.bindingId
    });
  }
}

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
