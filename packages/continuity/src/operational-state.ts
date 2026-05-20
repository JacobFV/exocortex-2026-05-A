import { continuityId, stableHash } from "./ids.js";
import { acceptPatch, proposePatch } from "./patch.js";
import type { ContinuityNode, ContinuityPatch, ContinuityPatchOp, ContinuityStore } from "./types.js";

export interface ContinuityCalibrationProfileInput {
  branchId: string;
  profileId: string;
  deviceKey: string;
  profile: unknown;
  active?: boolean;
  supersedesProfileId?: string;
  now?: Date;
}

export interface ContinuitySafetyGrantInput {
  branchId: string;
  grantId: string;
  channel: string;
  approvedBy: string;
  reason: string;
  expiresAt?: string;
  hazardous?: boolean;
  now?: Date;
}

export function acceptCalibrationProfile(store: ContinuityStore, input: ContinuityCalibrationProfileInput): ContinuityNode {
  const now = input.now ?? new Date();
  const stableKey = `calibration_profile:${input.deviceKey}:${input.profileId}`;
  const patch = operationalPatch(input.branchId, "calibration", stableKey, input.supersedesProfileId ? "Supersede calibration profile" : "Accept calibration profile", input.supersedesProfileId ? "high" : "medium", now);
  const node = {
    id: continuityId("node", input.branchId, stableKey),
    branchId: input.branchId,
    kind: "calibration_profile",
    stableKey,
    status: input.active === false ? "archived" : "active",
    createdByPatchId: patch.id,
    createdAt: now.toISOString(),
    metadata: {
      profileId: input.profileId,
      deviceKey: input.deviceKey,
      active: input.active ?? true,
      profileHash: stableHash(input.profile),
      profile: input.profile
    }
  } satisfies ContinuityNode;
  const ops: ContinuityPatchOp[] = [
    {
      id: continuityId("op", patch.id, "profile"),
      patchId: patch.id,
      op: store.findNodeByStableKey(input.branchId, stableKey) ? "update_node" : "create_node",
      createdAt: now.toISOString(),
      payload: {
        ...node,
        revision: {
          id: continuityId("rev", patch.id, stableKey, "v1"),
          nodeId: node.id,
          patchId: patch.id,
          version: 1,
          title: `Calibration profile ${input.profileId}`,
          createdAt: now.toISOString(),
          metadata: node.metadata
        }
      }
    }
  ];
  if (input.supersedesProfileId) {
    const superseded = store.findNodeByStableKey(input.branchId, `calibration_profile:${input.deviceKey}:${input.supersedesProfileId}`);
    if (superseded) {
      ops.push({
        id: continuityId("op", patch.id, "supersede_profile"),
        patchId: patch.id,
        op: "update_node",
        createdAt: now.toISOString(),
        payload: {
          ...superseded,
          status: "superseded",
          metadata: {
            ...superseded.metadata,
            active: false,
            supersededByProfileId: input.profileId
          },
          revision: {
            id: continuityId("rev", patch.id, superseded.stableKey, "superseded"),
            nodeId: superseded.id,
            patchId: patch.id,
            version: 1,
            title: `Calibration profile ${input.supersedesProfileId} superseded`,
            createdAt: now.toISOString(),
            metadata: {
              ...superseded.metadata,
              active: false,
              supersededByProfileId: input.profileId
            }
          }
        }
      });
      ops.push({
        id: continuityId("op", patch.id, "supersedes_edge"),
        patchId: patch.id,
        op: "create_edge",
        createdAt: now.toISOString(),
        payload: {
          id: continuityId("edge", input.branchId, node.id, "supersedes", superseded.id),
          branchId: input.branchId,
          fromNodeId: node.id,
          toNodeId: superseded.id,
          kind: "supersedes",
          status: "active",
          createdByPatchId: patch.id,
          createdAt: now.toISOString(),
          metadata: { deviceKey: input.deviceKey }
        }
      });
    }
  }
  proposePatch(store, patch, ops);
  acceptPatch(store, patch.id, "continuity-operational-state", now);
  return node;
}

export function acceptSafetyGrant(store: ContinuityStore, input: ContinuitySafetyGrantInput): ContinuityNode {
  const now = input.now ?? new Date();
  const stableKey = `safety_grant:${input.channel}:${input.grantId}`;
  const patch = operationalPatch(input.branchId, "safety", stableKey, "Accept safety grant", input.hazardous ? "hazardous" : "high", now);
  const node = {
    id: continuityId("node", input.branchId, stableKey),
    branchId: input.branchId,
    kind: "safety_grant",
    stableKey,
    status: "active",
    createdByPatchId: patch.id,
    createdAt: now.toISOString(),
    metadata: {
      grantId: input.grantId,
      channel: input.channel,
      approvedBy: input.approvedBy,
      reason: input.reason,
      expiresAt: input.expiresAt,
      hazardous: input.hazardous ?? false
    }
  } satisfies ContinuityNode;
  proposePatch(store, patch, [
    {
      id: continuityId("op", patch.id, "grant"),
      patchId: patch.id,
      op: store.findNodeByStableKey(input.branchId, stableKey) ? "update_node" : "create_node",
      createdAt: now.toISOString(),
      payload: {
        ...node,
        revision: {
          id: continuityId("rev", patch.id, stableKey, "v1"),
          nodeId: node.id,
          patchId: patch.id,
          version: 1,
          title: `Safety grant ${input.channel}`,
          body: input.reason,
          createdAt: now.toISOString(),
          metadata: node.metadata
        }
      }
    }
  ]);
  acceptPatch(store, patch.id, "continuity-operational-state", now);
  return node;
}

export function listActiveCalibrationProfiles(store: ContinuityStore, branchId: string, deviceKey?: string): ContinuityNode[] {
  return store
    .listNodes(branchId)
    .filter((node) => node.kind === "calibration_profile" && node.status === "active")
    .filter((node) => (node.metadata?.active ?? true) === true)
    .filter((node) => !deviceKey || node.metadata?.deviceKey === deviceKey);
}

export function listActiveSafetyGrants(store: ContinuityStore, branchId: string, channel?: string, now = new Date()): ContinuityNode[] {
  return store
    .listNodes(branchId)
    .filter((node) => node.kind === "safety_grant" && node.status === "active")
    .filter((node) => !channel || node.metadata?.channel === channel)
    .filter((node) => {
      const expiresAt = node.metadata?.expiresAt;
      return typeof expiresAt !== "string" || Date.parse(expiresAt) >= now.getTime();
    });
}

function operationalPatch(branchId: string, category: string, stableKey: string, reason: string, riskLevel: ContinuityPatch["riskLevel"], now: Date): ContinuityPatch {
  return {
    id: continuityId("patch", branchId, category, stableKey, now.toISOString()),
    branchId,
    status: "proposed",
    riskLevel,
    reason,
    createdAt: now.toISOString(),
    metadata: { category, stableKey }
  };
}
