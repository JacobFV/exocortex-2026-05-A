import type { AgentSession, AgentSessionEvent, AgentSessionEventPayload } from "@exocortex/protocol";

export interface AgentRuntimeContext {
  session: AgentSession;
  emit(event: AgentSessionEventPayload): AgentSessionEvent;
  signal: AbortSignal;
}

export interface AgentRuntime {
  start(context: AgentRuntimeContext): Promise<void>;
}

export class MockAgentRuntime implements AgentRuntime {
  async start(context: AgentRuntimeContext): Promise<void> {
    context.emit({
      type: "message.delta",
      role: "assistant",
      text: "Session online. Modality bindings active: "
    });
    context.emit({
      type: "message.delta",
      role: "assistant",
      text: context.session.modalityBindingIds.length.toString()
    });
    context.emit({
      type: "message.completed",
      role: "assistant",
      text: `I understand the goal: ${context.session.goal}`
    });
  }
}
