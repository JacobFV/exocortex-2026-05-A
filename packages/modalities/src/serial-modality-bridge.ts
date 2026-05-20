import type { ModalityInstance } from "@exocortex/protocol";
import { NodeSerialTransport, type NodeSerialTransportOptions, type SerialFrame } from "@exocortex/transports";
import type { ModalityBridge, ModalityObservation } from "./bridge.js";

export class SerialModalityBridge implements ModalityBridge {
  private readonly listeners = new Set<(observation: ModalityObservation) => void>();
  private readonly transport: NodeSerialTransport;

  constructor(readonly modality: ModalityInstance, options: NodeSerialTransportOptions) {
    this.transport = new NodeSerialTransport(options);
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

  async send(actionType: string, value: unknown): Promise<void> {
    await this.transport.write({
      channel: this.modality.key,
      type: actionType,
      value,
      timestamp: new Date().toISOString()
    });
  }

  subscribe(listener: (observation: ModalityObservation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handleFrame(frame: SerialFrame): void {
    if (frame.channel !== this.modality.key) return;
    for (const listener of this.listeners) {
      listener({
        modalityInstanceId: this.modality.id,
        observationType: frame.type,
        value: frame.value,
        observedAt: frame.timestamp ?? new Date().toISOString()
      });
    }
  }
}
