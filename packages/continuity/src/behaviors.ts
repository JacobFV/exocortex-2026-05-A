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

export function createContradictionReviewBehavior(options: UnsupportedClaimBehaviorOptions = {}): ContinuityBehavior {
  const id = options.id ?? "contradiction-review-behavior";
  return {
    id,
    evaluate(change, context) {
      const patches: Array<{ patch: ContinuityPatch; ops: ContinuityPatchOp[] }> = [];
      for (const nodeId of change.nodeIds) {
        const node = context.store.getNode(nodeId);
        if (!node || node.kind !== "claim") continue;
        const contradictions = [
          ...context.store.listEdges({ branchId: change.branchId, fromNodeId: node.id, kind: "contradicts" }),
          ...context.store.listEdges({ branchId: change.branchId, toNodeId: node.id, kind: "contradicts" })
        ].filter((edge) => edge.status === "active");
        if (!contradictions.length) continue;
        const taskStableKey = `task:review_contradiction:${node.id}`;
        if (context.store.findNodeByStableKey(change.branchId, taskStableKey)) continue;
        patches.push(makeTaskPatch(context.store, change, id, node.id, taskStableKey, "Review contradictory claims", options.taskPriority ?? 70));
      }
      return patches;
    }
  };
}

export function createStaleEvidenceBehavior(options: UnsupportedClaimBehaviorOptions = {}): ContinuityBehavior {
  const id = options.id ?? "stale-evidence-behavior";
  return {
    id,
    evaluate(change, context) {
      const patches: Array<{ patch: ContinuityPatch; ops: ContinuityPatchOp[] }> = [];
      for (const nodeId of change.nodeIds) {
        const node = context.store.getNode(nodeId);
        if (!node || node.kind !== "evidence") continue;
        const validUntil = typeof node.metadata?.validUntil === "string" ? Date.parse(node.metadata.validUntil) : Number.NaN;
        const stale = node.status === "stale" || node.metadata?.stale === true || (!Number.isNaN(validUntil) && validUntil <= context.now.getTime());
        if (!stale) continue;
        const taskStableKey = `task:refresh_evidence:${node.id}`;
        if (context.store.findNodeByStableKey(change.branchId, taskStableKey)) continue;
        patches.push(makeTaskPatch(context.store, change, id, node.id, taskStableKey, "Refresh stale evidence", options.taskPriority ?? 55));
      }
      return patches;
    }
  };
}

export function createHazardousActionApprovalBehavior(options: UnsupportedClaimBehaviorOptions = {}): ContinuityBehavior {
  const id = options.id ?? "hazardous-action-approval-behavior";
  return {
    id,
    evaluate(change, context) {
      const patches: Array<{ patch: ContinuityPatch; ops: ContinuityPatchOp[] }> = [];
      for (const nodeId of change.nodeIds) {
        const node = context.store.getNode(nodeId);
        if (!node || node.kind !== "evidence") continue;
        const actionType = String(node.metadata?.actionType ?? "");
        const value = node.metadata?.value;
        const enabled = value && typeof value === "object" && !Array.isArray(value) && (value as { enabled?: unknown }).enabled === true;
        const hazardous = node.metadata?.hazardous === true || (actionType.includes("actuator") && enabled);
        if (!hazardous) continue;
        const taskStableKey = `task:approve_hazardous_action:${node.id}`;
        if (context.store.findNodeByStableKey(change.branchId, taskStableKey)) continue;
        patches.push(makeTaskPatch(context.store, change, id, node.id, taskStableKey, "Approve hazardous action", options.taskPriority ?? 90));
      }
      return patches;
    }
  };
}

export function createCompletedDependencyBehavior(): ContinuityBehavior {
  const id = "completed-dependency-behavior";
  return {
    id,
    evaluate(change, context) {
      const patches: Array<{ patch: ContinuityPatch; ops: ContinuityPatchOp[] }> = [];
      for (const nodeId of change.nodeIds) {
        const node = context.store.getNode(nodeId);
        if (!node || node.kind !== "task" || node.metadata?.state !== "completed") continue;
        const dependentEdges = context.store.listEdges({ branchId: change.branchId, toNodeId: node.id, kind: "depends_on" }).filter((edge) => edge.status === "active");
        for (const edge of dependentEdges) {
          const dependent = context.store.getNode(edge.fromNodeId);
          if (!dependent || dependent.kind !== "task" || dependent.metadata?.blocked !== true) continue;
          const patchId = continuityId("patch", change.branchId, id, dependent.id, node.id);
          const now = context.now.toISOString();
          const revisionId = continuityId("rev", patchId, dependent.stableKey, "unblocked");
          const unblocksEdgeId = continuityId("edge", change.branchId, node.id, "unblocks", dependent.id);
          patches.push({
            patch: {
              id: patchId,
              branchId: change.branchId,
              status: "proposed",
              riskLevel: "low",
              reason: `Unblock task ${dependent.stableKey}`,
              createdAt: now,
              metadata: { behaviorId: id, sourcePatchId: change.patchId, sourceNodeId: node.id, targetNodeId: dependent.id }
            },
            ops: [
              {
                id: continuityId("op", patchId, "unblock_task"),
                patchId,
                op: "update_node",
                targetNodeId: dependent.id,
                createdAt: now,
                payload: {
                  ...dependent,
                  metadata: { ...dependent.metadata, blocked: false, unblockedByNodeId: node.id },
                  revision: {
                    id: revisionId,
                    nodeId: dependent.id,
                    patchId,
                    version: 2,
                    title: "Task unblocked",
                    createdAt: now,
                    metadata: { ...dependent.metadata, blocked: false, unblockedByNodeId: node.id }
                  }
                }
              },
              {
                id: continuityId("op", patchId, "unblocks_edge"),
                patchId,
                op: "create_edge",
                createdAt: now,
                payload: {
                  id: unblocksEdgeId,
                  branchId: change.branchId,
                  fromNodeId: node.id,
                  toNodeId: dependent.id,
                  kind: "unblocks",
                  status: "active",
                  createdByPatchId: patchId,
                  createdAt: now,
                  metadata: { behaviorId: id }
                }
              }
            ]
          });
        }
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
