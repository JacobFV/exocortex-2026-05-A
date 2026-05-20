import { continuityId, stableHash } from "./ids.js";
import { acceptPatch, proposePatch } from "./patch.js";
import type { ContinuityNode, ContinuityPatch, ContinuityPatchOp, ContinuityStore } from "./types.js";

export type ContinuityCapabilityKind = "tool" | "modality" | "model" | "device" | "policy" | "behavior";

export interface RegisterCapabilityInput {
  branchId: string;
  kind: ContinuityCapabilityKind;
  key: string;
  provider: string;
  version?: string;
  enabled?: boolean;
  definition?: unknown;
  now?: Date;
}

export interface RegisteredCapability {
  node: ContinuityNode;
  capabilityHash: string;
}

export class ContinuityCapabilityRegistry {
  constructor(private readonly store: ContinuityStore) {}

  register(input: RegisterCapabilityInput): RegisteredCapability {
    const now = input.now ?? new Date();
    const stableKey = `capability:${input.kind}:${input.key}`;
    const nodeId = continuityId("node", input.branchId, stableKey);
    const capabilityHash = stableHash({
      kind: input.kind,
      key: input.key,
      provider: input.provider,
      version: input.version,
      definition: input.definition
    });
    const existing = this.store.findNodeByStableKey(input.branchId, stableKey);
    if (
      existing?.status === (input.enabled === false ? "archived" : "active") &&
      existing.metadata?.capabilityHash === capabilityHash &&
      (existing.metadata.enabled ?? true) === (input.enabled ?? true)
    ) {
      return { node: existing, capabilityHash };
    }
    const patch = capabilityPatch(input.branchId, stableKey, "Register capability", now);
    const revisionId = continuityId("rev", patch.id, stableKey, "v1");
    const node: ContinuityNode = {
      id: nodeId,
      branchId: input.branchId,
      kind: "capability",
      stableKey,
      currentRevisionId: revisionId,
      status: input.enabled === false ? "archived" : "active",
      createdByPatchId: patch.id,
      createdAt: now.toISOString(),
      metadata: {
        capabilityKind: input.kind,
        key: input.key,
        provider: input.provider,
        version: input.version,
        enabled: input.enabled ?? true,
        capabilityHash,
        definition: input.definition
      }
    };
    const op: ContinuityPatchOp = {
      id: continuityId("op", patch.id, "capability", stableKey),
      patchId: patch.id,
      op: existing ? "update_node" : "create_node",
      createdAt: now.toISOString(),
      payload: {
        ...node,
        revision: {
          id: revisionId,
          nodeId,
          patchId: patch.id,
          version: 1,
          title: `${input.kind} capability ${input.key}`,
          createdAt: now.toISOString(),
          metadata: node.metadata
        }
      }
    };
    proposePatch(this.store, patch, [op]);
    acceptPatch(this.store, patch.id, "capability-registry", now);
    return { node, capabilityHash };
  }

  setEnabled(branchId: string, kind: ContinuityCapabilityKind, key: string, enabled: boolean, now = new Date()): ContinuityNode {
    const stableKey = `capability:${kind}:${key}`;
    const existing = this.store.findNodeByStableKey(branchId, stableKey);
    if (!existing) throw new Error(`Unknown capability: ${stableKey}`);
    const patch = capabilityPatch(branchId, stableKey, enabled ? "Enable capability" : "Disable capability", now);
    const next: ContinuityNode = {
      ...existing,
      status: enabled ? "active" : "archived",
      metadata: { ...(existing.metadata ?? {}), enabled }
    };
    proposePatch(this.store, patch, [
      {
        id: continuityId("op", patch.id, "set_enabled", stableKey),
        patchId: patch.id,
        op: "update_node",
        targetNodeId: existing.id,
        createdAt: now.toISOString(),
        payload: { ...next }
      }
    ]);
    acceptPatch(this.store, patch.id, "capability-registry", now);
    return next;
  }

  listEnabled(branchId: string, kind?: ContinuityCapabilityKind): ContinuityNode[] {
    return this.store
      .listNodes(branchId)
      .filter((node) => node.kind === "capability" && node.status === "active")
      .filter((node) => (node.metadata?.enabled ?? true) === true)
      .filter((node) => !kind || node.metadata?.capabilityKind === kind);
  }

  capabilitySetHash(branchId: string): string {
    return stableHash(
      this.listEnabled(branchId).map((node) => ({
        stableKey: node.stableKey,
        hash: node.metadata?.capabilityHash
      }))
    );
  }
}

function capabilityPatch(branchId: string, stableKey: string, reason: string, now: Date): ContinuityPatch {
  return {
    id: continuityId("patch", branchId, "capability", stableKey, now.toISOString()),
    branchId,
    status: "proposed",
    riskLevel: "low",
    reason,
    createdAt: now.toISOString(),
    metadata: { stableKey }
  };
}
