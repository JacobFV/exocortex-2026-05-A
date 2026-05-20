import { continuityId } from "./ids.js";
import type { ContinuityBranch, ContinuityEdge, ContinuityNode, ContinuityPatch, ContinuityPatchOp, ContinuityStore } from "./types.js";

export interface ContinuityBranchDiff {
  branchId: string;
  baseBranchId: string;
  addedNodes: ContinuityNode[];
  changedNodes: Array<{ base: ContinuityNode; branch: ContinuityNode }>;
  archivedNodes: ContinuityNode[];
  addedEdges: ContinuityEdge[];
  changedEdges: Array<{ base: ContinuityEdge; branch: ContinuityEdge }>;
  archivedEdges: ContinuityEdge[];
  conflicts: Array<{ stableKey: string; reason: string }>;
}

export interface ContinuityMergeProposal {
  patch: ContinuityPatch;
  ops: ContinuityPatchOp[];
  diff: ContinuityBranchDiff;
}

export function diffBranch(store: ContinuityStore, branchId: string, baseBranchId?: string): ContinuityBranchDiff {
  const branch = requireBranch(store, branchId);
  const base = requireBranch(store, baseBranchId ?? branch.parentBranchId ?? "main");
  const baseNodesByStableKey = new Map(store.listNodes(base.id).map((node) => [node.stableKey, node]));
  const branchNodes = store.listNodes(branch.id);
  const addedNodes: ContinuityNode[] = [];
  const changedNodes: Array<{ base: ContinuityNode; branch: ContinuityNode }> = [];
  const archivedNodes: ContinuityNode[] = [];
  const conflicts: Array<{ stableKey: string; reason: string }> = [];

  for (const node of branchNodes) {
    const baseNode = baseNodesByStableKey.get(node.stableKey);
    if (!baseNode) {
      if (node.status === "archived") archivedNodes.push(node);
      else addedNodes.push(node);
      continue;
    }
    if (node.currentRevisionId !== baseNode.currentRevisionId || node.status !== baseNode.status || JSON.stringify(node.metadata ?? {}) !== JSON.stringify(baseNode.metadata ?? {})) {
      changedNodes.push({ base: baseNode, branch: node });
    }
  }

  const baseEdgesByKey = new Map(store.listEdges({ branchId: base.id }).map((edge) => [edgeKey(edge), edge]));
  const addedEdges: ContinuityEdge[] = [];
  const changedEdges: Array<{ base: ContinuityEdge; branch: ContinuityEdge }> = [];
  const archivedEdges: ContinuityEdge[] = [];
  for (const edge of store.listEdges({ branchId: branch.id })) {
    const baseEdge = baseEdgesByKey.get(edgeKey(edge));
    if (!baseEdge) {
      if (edge.status === "archived") archivedEdges.push(edge);
      else addedEdges.push(edge);
      continue;
    }
    if (edge.status !== baseEdge.status || JSON.stringify(edge.metadata ?? {}) !== JSON.stringify(baseEdge.metadata ?? {})) {
      changedEdges.push({ base: baseEdge, branch: edge });
    }
  }

  for (const changed of changedNodes) {
    if (changed.base.status === "active" && changed.branch.status === "active" && changed.base.currentRevisionId !== changed.branch.currentRevisionId) {
      conflicts.push({ stableKey: changed.branch.stableKey, reason: "branch and base have different active revisions" });
    }
  }

  return { branchId: branch.id, baseBranchId: base.id, addedNodes, changedNodes, archivedNodes, addedEdges, changedEdges, archivedEdges, conflicts };
}

export function proposeBranchMerge(store: ContinuityStore, input: { branchId: string; baseBranchId?: string; decidedBy?: string; now?: Date }): ContinuityMergeProposal {
  const now = input.now ?? new Date();
  const diff = diffBranch(store, input.branchId, input.baseBranchId);
  if (diff.conflicts.length) {
    return {
      diff,
      patch: mergePatch(input.branchId, diff.baseBranchId, now, "failed", "Branch merge has conflicts"),
      ops: []
    };
  }
  const patch = mergePatch(input.branchId, diff.baseBranchId, now, "proposed", `Merge branch ${input.branchId} into ${diff.baseBranchId}`);
  const ops: ContinuityPatchOp[] = [];
  for (const node of [...diff.addedNodes, ...diff.changedNodes.map((changed) => changed.branch), ...diff.archivedNodes]) {
    ops.push({
      id: continuityId("op", patch.id, ops.length, "merge_node", node.id),
      patchId: patch.id,
      op: node.status === "archived" ? "archive_node" : store.findNodeByStableKey(diff.baseBranchId, node.stableKey) ? "update_node" : "create_node",
      targetNodeId: store.findNodeByStableKey(diff.baseBranchId, node.stableKey)?.id,
      createdAt: now.toISOString(),
      payload: { ...node, id: continuityId("node", diff.baseBranchId, node.stableKey), branchId: diff.baseBranchId, createdByPatchId: patch.id }
    });
  }
  for (const edge of [...diff.addedEdges, ...diff.changedEdges.map((changed) => changed.branch), ...diff.archivedEdges]) {
    ops.push({
      id: continuityId("op", patch.id, ops.length, "merge_edge", edge.id),
      patchId: patch.id,
      op: edge.status === "archived" ? "archive_edge" : "create_edge",
      createdAt: now.toISOString(),
      payload: { ...edge, id: continuityId("edge", diff.baseBranchId, edge.fromNodeId, edge.kind, edge.toNodeId), branchId: diff.baseBranchId, createdByPatchId: patch.id }
    });
  }
  return { patch, ops, diff };
}

function requireBranch(store: ContinuityStore, branchId: string): ContinuityBranch {
  const branch = store.getBranch(branchId);
  if (!branch) throw new Error(`Unknown continuity branch: ${branchId}`);
  return branch;
}

function edgeKey(edge: ContinuityEdge): string {
  return `${edge.fromNodeId}:${edge.kind}:${edge.toNodeId}`;
}

function mergePatch(branchId: string, baseBranchId: string, now: Date, status: ContinuityPatch["status"], reason: string): ContinuityPatch {
  return {
    id: continuityId("patch", baseBranchId, "merge", branchId, now.toISOString()),
    branchId: baseBranchId,
    status,
    riskLevel: "medium",
    reason,
    createdAt: now.toISOString(),
    metadata: { sourceBranchId: branchId, baseBranchId }
  };
}
