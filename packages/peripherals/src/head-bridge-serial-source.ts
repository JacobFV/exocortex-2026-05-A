import type { ModalityInstance } from "@exocortex/protocol";
import { NodeSerialTransport, type NodeSerialTransportOptions, type SerialFrame } from "@exocortex/transports";
import type { ModalityObservation } from "./bridge.js";

export class HeadBridgeSerialSource {
  private readonly transport: NodeSerialTransport;
  private readonly modalitiesByKey = new Map<string, ModalityInstance>();
  private readonly listeners = new Set<(observation: ModalityObservation) => void>();

  constructor(modalities: ModalityInstance[], options: NodeSerialTransportOptions) {
    this.transport = new NodeSerialTransport(options);
    for (const modality of modalities) {
      this.modalitiesByKey.set(modality.key, modality);
    }
  }

  async start(): Promise<void> {
    this.transport.on("frame", (frame) => this.handleFrame(frame));
    this.transport.on("error", (error) => {
      throw error;
    });
    await this.transport.open();
  }

  async stop(): Promise<void> {
    this.listeners.clear();
    await this.transport.close();
  }

  subscribe(listener: (observation: ModalityObservation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(channel: string, actionType: string, value: unknown): Promise<void> {
    await this.transport.write({
      channel,
      type: actionType,
      value,
      timestamp: new Date().toISOString()
    });
  }

  private handleFrame(frame: SerialFrame): void {
    const modality = this.modalitiesByKey.get(frame.channel);
    if (!modality) return;
    for (const listener of this.listeners) {
      listener({
        modalityInstanceId: modality.id,
        observationType: frame.type,
        value: frame.value,
        observedAt: frame.timestamp ?? new Date().toISOString()
      });
    }
  }
}
