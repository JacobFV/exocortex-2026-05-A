import type {
  ContinuityBranch,
  ContinuityEdge,
  ContinuityEdgeRevision,
  ContinuityGraphChange,
  ContinuityNode,
  ContinuityNodeRevision,
  ContinuityPatch,
  ContinuityPatchOp,
  ContinuityStore
} from "./types.js";

export interface ApplyPatchResult {
  patch: ContinuityPatch;
  change?: ContinuityGraphChange;
}

export function ensureMainBranch(store: ContinuityStore, now = new Date()): ContinuityBranch {
  const existing = store.getBranch("main");
  if (existing) return existing;
  const branch: ContinuityBranch = {
    id: "main",
    name: "main",
    status: "active",
    createdFor: "default operational branch",
    createdAt: now.toISOString()
  };
  store.putBranch(branch);
  return branch;
}

export function proposePatch(store: ContinuityStore, patch: ContinuityPatch, ops: ContinuityPatchOp[]): ContinuityPatch {
  store.putPatch({ ...patch, status: "proposed" });
  for (const op of ops) store.putPatchOp(op);
  return { ...patch, status: "proposed" };
}

export function acceptPatch(store: ContinuityStore, patchId: string, decidedBy: string, now = new Date()): ApplyPatchResult {
  const patch = requirePatch(store, patchId);
  const accepted: ContinuityPatch = {
    ...patch,
    status: "accepted",
    decidedAt: now.toISOString(),
    decidedBy
  };
  return store.transaction(() => {
    store.putPatch(accepted);
    const change = applyAcceptedPatch(store, accepted, store.listPatchOps(patchId), now);
    return { patch: accepted, change };
  });
}

export function rejectPatch(store: ContinuityStore, patchId: string, decidedBy: string, now = new Date()): ContinuityPatch {
  const patch = requirePatch(store, patchId);
  const rejected: ContinuityPatch = {
    ...patch,
    status: "rejected",
    decidedAt: now.toISOString(),
    decidedBy
  };
  store.putPatch(rejected);
  return rejected;
}

export function applyAcceptedPatch(store: ContinuityStore, patch: ContinuityPatch, ops: ContinuityPatchOp[], now = new Date()): ContinuityGraphChange {
  if (patch.status !== "accepted") throw new Error(`Cannot apply non-accepted continuity patch: ${patch.id}`);
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case "create_node":
      case "update_node": {
        const node = parsePayload<ContinuityNode>(op.payload, op.op);
        const existing = store.getNode(node.id);
        store.putNode({ ...existing, ...node, createdByPatchId: node.createdByPatchId ?? patch.id });
        if (op.payload.revision && isRecord(op.payload.revision)) {
          const revision = op.payload.revision as unknown as ContinuityNodeRevision;
          store.putNodeRevision({ ...revision, nodeId: node.id, patchId: patch.id, createdAt: revision.createdAt ?? now.toISOString() });
          const next = store.getNode(node.id)!;
          store.putNode({ ...next, currentRevisionId: revision.id });
        }
        nodeIds.push(node.id);
        break;
      }
      case "archive_node": {
        const node = requireNode(store, op.targetNodeId);
        store.putNode({ ...node, status: "archived" });
        nodeIds.push(node.id);
        break;
      }
      case "create_edge":
      case "update_edge": {
        const edge = parsePayload<ContinuityEdge>(op.payload, op.op);
        const existing = store.getEdge(edge.id);
        store.putEdge({ ...existing, ...edge, createdByPatchId: edge.createdByPatchId ?? patch.id });
        if (op.payload.revision && isRecord(op.payload.revision)) {
          const revision = op.payload.revision as unknown as ContinuityEdgeRevision;
          store.putEdgeRevision({ ...revision, edgeId: edge.id, patchId: patch.id, createdAt: revision.createdAt ?? now.toISOString() });
        }
        edgeIds.push(edge.id);
        break;
      }
      case "archive_edge": {
        const edge = requireEdge(store, op.targetEdgeId);
        store.putEdge({ ...edge, status: "archived" });
        edgeIds.push(edge.id);
        break;
      }
    }
  }
  return { branchId: patch.branchId, patchId: patch.id, nodeIds, edgeIds, changedAt: now.toISOString() };
}

function requirePatch(store: ContinuityStore, patchId: string): ContinuityPatch {
  const patch = store.getPatch(patchId);
  if (!patch) throw new Error(`Unknown continuity patch: ${patchId}`);
  return patch;
}

function requireNode(store: ContinuityStore, nodeId: string | undefined): ContinuityNode {
  if (!nodeId) throw new Error("Patch op requires targetNodeId");
  const node = store.getNode(nodeId);
  if (!node) throw new Error(`Unknown continuity node: ${nodeId}`);
  return node;
}

function requireEdge(store: ContinuityStore, edgeId: string | undefined): ContinuityEdge {
  if (!edgeId) throw new Error("Patch op requires targetEdgeId");
  const edge = store.getEdge(edgeId);
  if (!edge) throw new Error(`Unknown continuity edge: ${edgeId}`);
  return edge;
}

function parsePayload<T>(payload: Record<string, unknown>, op: string): T {
  if (!payload.id || typeof payload.id !== "string") throw new Error(`Patch op ${op} payload requires id`);
  return payload as unknown as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
