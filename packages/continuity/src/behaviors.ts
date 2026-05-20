import { continuityId } from "./ids.js";
import type { ContinuityBehavior, ContinuityGraphChange, ContinuityPatch, ContinuityPatchOp, ContinuityStore } from "./types.js";

export interface FailureReviewBehaviorOptions {
  id?: string;
  taskPriority?: number;
}

export function createFailureReviewBehavior(options: FailureReviewBehaviorOptions = {}): ContinuityBehavior {
  const id = options.id ?? "failure-review-behavior";
  return {
    id,
    evaluate(change, context) {
      const patches: Array<{ patch: ContinuityPatch; ops: ContinuityPatchOp[] }> = [];
      for (const nodeId of change.nodeIds) {
        const node = context.store.getNode(nodeId);
        if (!node || node.kind !== "failure") continue;
        const taskStableKey = `task:review_failure:${node.id}`;
        if (context.store.findNodeByStableKey(change.branchId, taskStableKey)) continue;
        const patchId = continuityId("patch", change.branchId, id, node.id);
        const now = context.now.toISOString();
        const taskNodeId = continuityId("node", change.branchId, taskStableKey);
        const revisionId = continuityId("rev", patchId, taskStableKey, "v1");
        const edgeId = continuityId("edge", change.branchId, taskNodeId, "depends_on", node.id);
        const patch: ContinuityPatch = {
          id: patchId,
          branchId: change.branchId,
          status: "proposed",
          riskLevel: "low",
          reason: `Create review task for failure ${node.stableKey}`,
          createdAt: now,
          metadata: { behaviorId: id, sourcePatchId: change.patchId, sourceNodeId: node.id }
        };
        patches.push({
          patch,
          ops: [
            {
              id: continuityId("op", patchId, "create_task"),
              patchId,
              op: "create_node",
              createdAt: now,
              payload: {
                id: taskNodeId,
                branchId: change.branchId,
                kind: "task",
                stableKey: taskStableKey,
                status: "active",
                createdByPatchId: patchId,
                createdAt: now,
                metadata: { behaviorId: id, state: "open", priority: options.taskPriority ?? 50 },
                revision: {
                  id: revisionId,
                  nodeId: taskNodeId,
                  patchId,
                  version: 1,
                  title: "Review failure",
                  body: `Review failure node ${node.stableKey}`,
                  createdAt: now,
                  metadata: { behaviorId: id }
                }
              }
            },
            {
              id: continuityId("op", patchId, "task_depends_on_failure"),
              patchId,
              op: "create_edge",
              createdAt: now,
              payload: {
                id: edgeId,
                branchId: change.branchId,
                fromNodeId: taskNodeId,
                toNodeId: node.id,
                kind: "depends_on",
                status: "active",
                createdByPatchId: patchId,
                createdAt: now,
                metadata: { behaviorId: id }
              }
            }
          ]
        });
      }
      return patches;
    }
  };
}

export interface UnsupportedClaimBehaviorOptions {
  id?: string;
  taskPriority?: number;
}

export function createUnsupportedClaimBehavior(options: UnsupportedClaimBehaviorOptions = {}): ContinuityBehavior {
  const id = options.id ?? "unsupported-claim-behavior";
  return {
    id,
    evaluate(change, context) {
      const patches: Array<{ patch: ContinuityPatch; ops: ContinuityPatchOp[] }> = [];
      for (const nodeId of change.nodeIds) {
        const node = context.store.getNode(nodeId);
        if (!node || node.kind !== "claim") continue;
        const supportingEdges = context.store.listEdges({ branchId: change.branchId, fromNodeId: node.id, kind: "supports" });
        if (supportingEdges.length) continue;
        const taskStableKey = `task:verify_claim:${node.id}`;
        if (context.store.findNodeByStableKey(change.branchId, taskStableKey)) continue;
        patches.push(makeTaskPatch(context.store, change, id, node.id, taskStableKey, "Verify unsupported claim", options.taskPriority ?? 60));
      }
      return patches;
    }
  };
}

function makeTaskPatch(
  _store: ContinuityStore,
  change: ContinuityGraphChange,
  behaviorId: string,
  dependencyNodeId: string,
  taskStableKey: string,
  title: string,
  priority: number
): { patch: ContinuityPatch; ops: ContinuityPatchOp[] } {
  const patchId = continuityId("patch", change.branchId, behaviorId, dependencyNodeId);
  const now = new Date(change.changedAt).toISOString();
  const taskNodeId = continuityId("node", change.branchId, taskStableKey);
  const revisionId = continuityId("rev", patchId, taskStableKey, "v1");
  const edgeId = continuityId("edge", change.branchId, taskNodeId, "depends_on", dependencyNodeId);
  return {
    patch: {
      id: patchId,
      branchId: change.branchId,
      status: "proposed",
      riskLevel: "low",
      reason: title,
      createdAt: now,
      metadata: { behaviorId, sourcePatchId: change.patchId, sourceNodeId: dependencyNodeId }
    },
    ops: [
      {
        id: continuityId("op", patchId, "create_task"),
        patchId,
        op: "create_node",
        createdAt: now,
        payload: {
          id: taskNodeId,
          branchId: change.branchId,
          kind: "task",
          stableKey: taskStableKey,
          status: "active",
          createdByPatchId: patchId,
          createdAt: now,
          metadata: { behaviorId, state: "open", priority },
          revision: { id: revisionId, nodeId: taskNodeId, patchId, version: 1, title, createdAt: now, metadata: { behaviorId } }
        }
      },
      {
        id: continuityId("op", patchId, "task_depends_on_source"),
        patchId,
        op: "create_edge",
        createdAt: now,
        payload: {
          id: edgeId,
          branchId: change.branchId,
          fromNodeId: taskNodeId,
          toNodeId: dependencyNodeId,
          kind: "depends_on",
          status: "active",
          createdByPatchId: patchId,
          createdAt: now,
          metadata: { behaviorId }
        }
      }
    ]
  };
}
