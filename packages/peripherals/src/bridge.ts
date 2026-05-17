import type { AgentSessionModality, AgentSessionModalityId } from "@exocortex/protocol";

export interface ModalityObservation {
  modalityId: AgentSessionModalityId;
  observationType: string;
  value: unknown;
  observedAt: string;
}

export interface ModalityBridge {
  readonly modality: AgentSessionModality;
  start(): Promise<void>;
  stop(): Promise<void>;
  send?(actionType: string, value: unknown): Promise<void>;
  subscribe?(listener: (observation: ModalityObservation) => void): () => void;
}

export class ManualInputBridge implements ModalityBridge {
  private readonly listeners = new Set<(observation: ModalityObservation) => void>();

  constructor(readonly modality: AgentSessionModality) {}

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.listeners.clear();
  }

  subscribe(listener: (observation: ModalityObservation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  injectText(text: string, partial = false): void {
    for (const listener of this.listeners) {
      listener({
        modalityId: this.modality.id,
        observationType: partial ? "text.partial" : "text.final",
        value: { text },
        observedAt: new Date().toISOString()
      });
    }
  }
}
