import type {
  ContinuityBranch,
  ContinuityEdge,
  ContinuityEdgeKind,
  ContinuityEdgeRevision,
  ContinuityNode,
  ContinuityNodeRevision,
  ContinuityPatch,
  ContinuityPatchOp,
  ContinuityStore
} from "./types.js";

export class InMemoryContinuityStore implements ContinuityStore {
  private readonly branches = new Map<string, ContinuityBranch>();
  private readonly patches = new Map<string, ContinuityPatch>();
  private readonly patchOps = new Map<string, ContinuityPatchOp[]>();
  private readonly nodes = new Map<string, ContinuityNode>();
  private readonly nodeRevisions = new Map<string, ContinuityNodeRevision[]>();
  private readonly edges = new Map<string, ContinuityEdge>();
  private readonly edgeRevisions = new Map<string, ContinuityEdgeRevision[]>();
  private readonly projectionOffsets = new Map<string, number>();

  putBranch(branch: ContinuityBranch): void {
    this.branches.set(branch.id, clone(branch));
  }

  getBranch(id: string): ContinuityBranch | undefined {
    return cloneOrUndefined(this.branches.get(id));
  }

  listBranches(): ContinuityBranch[] {
    return [...this.branches.values()].map(clone);
  }

  putPatch(patch: ContinuityPatch): void {
    this.patches.set(patch.id, clone(patch));
  }

  getPatch(id: string): ContinuityPatch | undefined {
    return cloneOrUndefined(this.patches.get(id));
  }

  listPatches(branchId: string): ContinuityPatch[] {
    return [...this.patches.values()].filter((patch) => patch.branchId === branchId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
  }

  putPatchOp(op: ContinuityPatchOp): void {
    const ops = this.patchOps.get(op.patchId) ?? [];
    const index = ops.findIndex((candidate) => candidate.id === op.id);
    if (index >= 0) ops[index] = clone(op);
    else ops.push(clone(op));
    this.patchOps.set(op.patchId, ops);
  }

  listPatchOps(patchId: string): ContinuityPatchOp[] {
    return [...(this.patchOps.get(patchId) ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
  }

  putNode(node: ContinuityNode): void {
    const existing = [...this.nodes.values()].find((candidate) => candidate.branchId === node.branchId && candidate.stableKey === node.stableKey && candidate.id !== node.id);
    if (existing) throw new Error(`Continuity node stable key already exists on branch ${node.branchId}: ${node.stableKey}`);
    this.nodes.set(node.id, clone(node));
  }

  putNodeRevision(revision: ContinuityNodeRevision): void {
    const revisions = this.nodeRevisions.get(revision.nodeId) ?? [];
    const index = revisions.findIndex((candidate) => candidate.id === revision.id);
    if (index >= 0) revisions[index] = clone(revision);
    else revisions.push(clone(revision));
    this.nodeRevisions.set(revision.nodeId, revisions);
  }

  getNode(id: string): ContinuityNode | undefined {
    return cloneOrUndefined(this.nodes.get(id));
  }

  findNodeByStableKey(branchId: string, stableKey: string): ContinuityNode | undefined {
    return cloneOrUndefined([...this.nodes.values()].find((node) => node.branchId === branchId && node.stableKey === stableKey));
  }

  listNodes(branchId: string): ContinuityNode[] {
    return [...this.nodes.values()].filter((node) => node.branchId === branchId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
  }

  putEdge(edge: ContinuityEdge): void {
    this.edges.set(edge.id, clone(edge));
  }

  putEdgeRevision(revision: ContinuityEdgeRevision): void {
    const revisions = this.edgeRevisions.get(revision.edgeId) ?? [];
    const index = revisions.findIndex((candidate) => candidate.id === revision.id);
    if (index >= 0) revisions[index] = clone(revision);
    else revisions.push(clone(revision));
    this.edgeRevisions.set(revision.edgeId, revisions);
  }

  getEdge(id: string): ContinuityEdge | undefined {
    return cloneOrUndefined(this.edges.get(id));
  }

  listEdges(query: { branchId: string; fromNodeId?: string; toNodeId?: string; kind?: ContinuityEdgeKind }): ContinuityEdge[] {
    return [...this.edges.values()]
      .filter((edge) => edge.branchId === query.branchId)
      .filter((edge) => !query.fromNodeId || edge.fromNodeId === query.fromNodeId)
      .filter((edge) => !query.toNodeId || edge.toNodeId === query.toNodeId)
      .filter((edge) => !query.kind || edge.kind === query.kind)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  getProjectionOffset(branchId: string, projectorId: string): number {
    return this.projectionOffsets.get(offsetKey(branchId, projectorId)) ?? 0;
  }

  setProjectionOffset(branchId: string, projectorId: string, sequence: number): void {
    this.projectionOffsets.set(offsetKey(branchId, projectorId), sequence);
  }

  transaction<T>(fn: () => T): T {
    return fn();
  }
}

function offsetKey(branchId: string, projectorId: string): string {
  return `${branchId}:${projectorId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneOrUndefined<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}
