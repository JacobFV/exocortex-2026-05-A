import type { AgentSessionEvent, AgentSessionEventId } from "@exocortex/protocol";

export type ContinuityBranchStatus = "active" | "merged" | "abandoned" | "archived";
export type ContinuityNodeStatus = "active" | "stale" | "superseded" | "rejected" | "archived";
export type ContinuityPatchStatus = "proposed" | "accepted" | "rejected" | "superseded" | "failed";
export type ContinuityRiskLevel = "low" | "medium" | "high" | "hazardous";
export type ContinuityPatchOpType = "create_node" | "update_node" | "archive_node" | "create_edge" | "update_edge" | "archive_edge";

export type ContinuityNodeKind =
  | "goal"
  | "task"
  | "claim"
  | "evidence"
  | "decision"
  | "question"
  | "answer"
  | "artifact"
  | "session"
  | "modality"
  | "device"
  | "tool"
  | "capability"
  | "policy"
  | "approval"
  | "failure"
  | "evaluation"
  | "patch"
  | "fork"
  | "agent_version"
  | "calibration_profile"
  | "safety_grant"
  | "browser_session"
  | "computer_session";

export type ContinuityEdgeKind =
  | "supports"
  | "contradicts"
  | "depends_on"
  | "blocks"
  | "unblocks"
  | "derived_from"
  | "produced_by"
  | "observed_from"
  | "uses"
  | "controls"
  | "approved_by"
  | "rejected_by"
  | "invalidated_by"
  | "supersedes"
  | "forked_from"
  | "evaluated_by";

export interface ContinuityBranch {
  id: string;
  name: string;
  parentBranchId?: string;
  forkedFromEventId?: AgentSessionEventId;
  forkedFromPatchId?: string;
  status: ContinuityBranchStatus;
  createdFor: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ContinuityNode {
  id: string;
  branchId: string;
  kind: ContinuityNodeKind;
  stableKey: string;
  currentRevisionId?: string;
  status: ContinuityNodeStatus;
  createdByEventId?: AgentSessionEventId;
  createdByPatchId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ContinuityNodeRevision {
  id: string;
  nodeId: string;
  patchId: string;
  version: number;
  title?: string;
  body?: string;
  confidence?: number;
  validFrom?: string;
  validUntil?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ContinuityEdge {
  id: string;
  branchId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: ContinuityEdgeKind;
  status: ContinuityNodeStatus;
  createdByEventId?: AgentSessionEventId;
  createdByPatchId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ContinuityEdgeRevision {
  id: string;
  edgeId: string;
  patchId: string;
  version: number;
  status: ContinuityNodeStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ContinuityPatch {
  id: string;
  branchId: string;
  status: ContinuityPatchStatus;
  proposedByEventId?: AgentSessionEventId;
  proposedByToolCallId?: string;
  proposedByAgentVersionId?: string;
  riskLevel: ContinuityRiskLevel;
  reason: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface ContinuityPatchOp {
  id: string;
  patchId: string;
  op: ContinuityPatchOpType;
  targetNodeId?: string;
  targetEdgeId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ContinuityGraphChange {
  branchId: string;
  patchId: string;
  nodeIds: string[];
  edgeIds: string[];
  changedAt: string;
}

export interface ContinuityProjectionReport {
  branchId: string;
  projectedEventCount: number;
  proposedPatchCount: number;
  acceptedPatchCount: number;
}

export interface ContinuityProjectorContext {
  branchId: string;
  now: Date;
}

export interface ContinuityProjector {
  project(event: AgentSessionEvent, context: ContinuityProjectorContext): Array<{ patch: ContinuityPatch; ops: ContinuityPatchOp[]; autoAccept: boolean }>;
}

export interface ContinuityBehaviorContext {
  store: ContinuityStore;
  now: Date;
}

export interface ContinuityBehavior {
  id: string;
  evaluate(change: ContinuityGraphChange, context: ContinuityBehaviorContext): Promise<Array<{ patch: ContinuityPatch; ops: ContinuityPatchOp[] }>> | Array<{ patch: ContinuityPatch; ops: ContinuityPatchOp[] }>;
}

export interface ContinuityStore {
  putBranch(branch: ContinuityBranch): void;
  getBranch(id: string): ContinuityBranch | undefined;
  listBranches(): ContinuityBranch[];
  putPatch(patch: ContinuityPatch): void;
  getPatch(id: string): ContinuityPatch | undefined;
  listPatches(branchId: string): ContinuityPatch[];
  putPatchOp(op: ContinuityPatchOp): void;
  listPatchOps(patchId: string): ContinuityPatchOp[];
  putNode(node: ContinuityNode): void;
  putNodeRevision(revision: ContinuityNodeRevision): void;
  getNode(id: string): ContinuityNode | undefined;
  findNodeByStableKey(branchId: string, stableKey: string): ContinuityNode | undefined;
  listNodes(branchId: string): ContinuityNode[];
  putEdge(edge: ContinuityEdge): void;
  putEdgeRevision(revision: ContinuityEdgeRevision): void;
  getEdge(id: string): ContinuityEdge | undefined;
  listEdges(query: { branchId: string; fromNodeId?: string; toNodeId?: string; kind?: ContinuityEdgeKind }): ContinuityEdge[];
  getProjectionOffset(branchId: string, projectorId: string): number;
  setProjectionOffset(branchId: string, projectorId: string, sequence: number): void;
  transaction<T>(fn: () => T): T;
}

export const MAIN_BRANCH_ID = "main";
