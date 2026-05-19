import type { AgentSessionEvent, AgentSessionModalityBinding, AgentSessionModalityId, ModalityInstanceId } from "@exocortex/protocol";
import type { AgentSessionManager } from "./session-manager.js";

export interface ModalityActionSink {
  send(actionType: string, value: unknown): Promise<void>;
}

export class ModalityActionRouter {
  private readonly sinks = new Map<ModalityInstanceId, ModalityActionSink>();
  private readonly bindings = new Map<AgentSessionModalityId, AgentSessionModalityBinding>();
  private unsubscribe?: () => void;

  constructor(private readonly sessions: AgentSessionManager) {}

  start(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.sessions.subscribe("*", (event) => {
      if (event.type === "modality.action") void this.route(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  bindSession(bindings: AgentSessionModalityBinding[]): void {
    for (const binding of bindings) {
      this.bindings.set(binding.id, binding);
    }
  }

  registerSink(modalityInstanceId: ModalityInstanceId, sink: ModalityActionSink): void {
    this.sinks.set(modalityInstanceId, sink);
  }

  private async route(event: Extract<AgentSessionEvent, { type: "modality.action" }>): Promise<void> {
    const binding = this.bindings.get(event.bindingId);
    if (!binding) return;
    const sink = this.sinks.get(binding.modalityInstanceId);
    if (!sink) return;
    await sink.send(event.actionType, event.value);
  }
}
