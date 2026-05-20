import { EventSourcedGraph } from "./event-graph.js";
import { stableHash } from "./event-graph-ids.js";
import type { GraphObject } from "./event-graph-types.js";

export type ContinuityCapabilityKind = "tool" | "modality" | "model" | "device" | "policy" | "behavior";

export interface RegisterCapabilityInput {
  kind: ContinuityCapabilityKind;
  key: string;
  provider: string;
  version?: string;
  enabled?: boolean;
  definition?: unknown;
  now?: Date;
}

export interface RegisteredCapability {
  object: GraphObject;
  capabilityHash: string;
}

export class EventGraphCapabilityRegistry {
  constructor(private readonly graph: EventSourcedGraph) {}

  register(input: RegisterCapabilityInput): RegisteredCapability {
    const capabilityHash = stableHash({
      kind: input.kind,
      key: input.key,
      provider: input.provider,
      version: input.version,
      definition: input.definition
    });
    const stableKey = capabilityStableKey(input.kind, input.key);
    const data = {
      stableKey,
      capabilityKind: input.kind,
      key: input.key,
      provider: input.provider,
      version: input.version,
      enabled: input.enabled ?? true,
      capabilityHash,
      definition: input.definition
    };
    const object = upsertGraphObject(this.graph, stableKey, "capability", data, "capability-registry", input.now);
    return { object, capabilityHash };
  }

  setEnabled(kind: ContinuityCapabilityKind, key: string, enabled: boolean, now = new Date()): GraphObject {
    const stableKey = capabilityStableKey(kind, key);
    const existing = this.findCapability(kind, key);
    if (!existing) throw new Error(`Unknown capability: ${stableKey}`);
    this.graph.patchObject(existing.id, { enabled }, { actor: "capability-registry", createdAt: now, reason: enabled ? "Enable capability" : "Disable capability" });
    return this.graph.getObject(existing.id)!;
  }

  listEnabled(kind?: ContinuityCapabilityKind): GraphObject[] {
    return this.graph
      .findObjects({ type: "capability" })
      .filter((object) => (object.data.enabled ?? true) === true)
      .filter((object) => !kind || object.data.capabilityKind === kind);
  }

  findCapability(kind: ContinuityCapabilityKind, key: string): GraphObject | undefined {
    return this.graph.findObjects({ type: "capability", where: { stableKey: capabilityStableKey(kind, key) } })[0];
  }

  capabilitySetHash(): string {
    return stableHash(
      this.listEnabled().map((object) => ({
        stableKey: object.data.stableKey,
        hash: object.data.capabilityHash
      }))
    );
  }
}

function capabilityStableKey(kind: ContinuityCapabilityKind, key: string): string {
  return `capability:${kind}:${key}`;
}

function upsertGraphObject(graph: EventSourcedGraph, stableKey: string, type: string, data: Record<string, unknown>, actor: string, createdAt?: Date): GraphObject {
  const existing = graph.findObjects({ type, where: { stableKey } })[0];
  if (!existing) return graph.addObject(type, data, { actor, createdAt });
  if (stableHash(existing.data) !== stableHash(data)) graph.patchObject(existing.id, data, { actor, createdAt, reason: `Update ${type} ${stableKey}` });
  return graph.getObject(existing.id)!;
}
