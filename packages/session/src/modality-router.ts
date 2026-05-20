import type { AgentSessionId, AgentSessionModalityBinding, ModalityInstanceId } from "@exocortex/protocol";
import type { ModalityBridge, ModalityObservation } from "@exocortex/modalities";
import type { AgentSessionManager } from "./session-manager.js";

export class ModalityObservationRouter {
  private readonly bridges = new Map<ModalityInstanceId, ModalityBridge>();
  private readonly sources = new Map<string, { start(): Promise<void>; stop(): Promise<void> }>();
  private readonly unsubs = new Map<ModalityInstanceId, () => void>();
  private readonly sourceUnsubs = new Map<string, () => void>();
  private readonly bindingsBySession = new Map<AgentSessionId, AgentSessionModalityBinding[]>();

  constructor(private readonly sessions: AgentSessionManager) {}

  attachBridge(bridge: ModalityBridge): void {
    this.detachBridge(bridge.modality.id);
    this.bridges.set(bridge.modality.id, bridge);
    const unsubscribe = bridge.subscribe?.((observation) => this.routeObservation(observation));
    if (unsubscribe) this.unsubs.set(bridge.modality.id, unsubscribe);
  }

  attachObservationSource(key: string, source: { subscribe(listener: (observation: ModalityObservation) => void): () => void; start(): Promise<void>; stop(): Promise<void> }): void {
    this.detachObservationSource(key);
    this.sources.set(key, source);
    const unsubscribe = source.subscribe((observation) => this.routeObservation(observation));
    this.sourceUnsubs.set(key, unsubscribe);
  }

  detachObservationSource(key: string): void {
    this.sourceUnsubs.get(key)?.();
    this.sourceUnsubs.delete(key);
    this.sources.delete(key);
  }

  detachBridge(modalityInstanceId: ModalityInstanceId): void {
    this.unsubs.get(modalityInstanceId)?.();
    this.unsubs.delete(modalityInstanceId);
    this.bridges.delete(modalityInstanceId);
  }

  bindSession(sessionId: AgentSessionId, bindings: AgentSessionModalityBinding[]): void {
    this.bindingsBySession.set(sessionId, bindings.map((binding) => ({ ...binding, capabilities: [...binding.capabilities] })));
  }

  unbindSession(sessionId: AgentSessionId): void {
    this.bindingsBySession.delete(sessionId);
  }

  async startAll(): Promise<void> {
    await Promise.all([
      ...[...this.bridges.values()].map((bridge) => bridge.start()),
      ...[...this.sources.values()].map((source) => source.start())
    ]);
  }

  async stopAll(): Promise<void> {
    await Promise.all([
      ...[...this.bridges.values()].map((bridge) => bridge.stop()),
      ...[...this.sources.values()].map((source) => source.stop())
    ]);
    this.unsubs.clear();
    this.sourceUnsubs.clear();
    this.bridges.clear();
    this.sources.clear();
  }

  private routeObservation(observation: ModalityObservation): void {
    for (const [sessionId, bindings] of this.bindingsBySession.entries()) {
      const binding = observation.bindingId
        ? bindings.find((candidate) => candidate.id === observation.bindingId)
        : bindings.find((candidate) => candidate.modalityInstanceId === observation.modalityInstanceId);
      if (!binding) continue;
      if (binding.policy === "disabled" || binding.policy === "control") continue;
      const session = this.sessions.get(sessionId);
      if (!session || session.state !== "running") continue;
      this.sessions.observe(sessionId, binding.id, observation.observationType, observation.value, observation.observedAt);
    }
  }
}
