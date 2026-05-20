import type { AgentSessionEvent } from "@exocortex/protocol";
import { CoreContinuityProjector, CORE_PROJECTOR_ID } from "./projector.js";
import { acceptPatch, ensureMainBranch, proposePatch, rejectPatch } from "./patch.js";
import type {
  ContinuityBehavior,
  ContinuityBranch,
  ContinuityGraphChange,
  ContinuityPatch,
  ContinuityPatchOp,
  ContinuityProjector,
  ContinuityStore
} from "./types.js";
import { MAIN_BRANCH_ID } from "./types.js";

export interface ContinuityKernelOptions {
  store: ContinuityStore;
  projectors?: ContinuityProjector[];
  behaviors?: ContinuityBehavior[];
  defaultBranchId?: string;
}

export class ContinuityKernel {
  private readonly projectors: ContinuityProjector[];
  private readonly behaviors: ContinuityBehavior[];
  private readonly listeners = new Set<(change: ContinuityGraphChange) => void>();
  private readonly defaultBranchId: string;

  constructor(private readonly options: ContinuityKernelOptions) {
    this.projectors = options.projectors ?? [new CoreContinuityProjector()];
    this.behaviors = options.behaviors ?? [];
    this.defaultBranchId = options.defaultBranchId ?? MAIN_BRANCH_ID;
    ensureMainBranch(options.store);
  }

  get store(): ContinuityStore {
    return this.options.store;
  }

  createBranch(input: { id: string; name?: string; parentBranchId?: string; forkedFromEventId?: ContinuityBranch["forkedFromEventId"]; forkedFromPatchId?: string; createdFor: string; metadata?: Record<string, unknown>; now?: Date }): ContinuityBranch {
    const now = input.now ?? new Date();
    const branch: ContinuityBranch = {
      id: input.id,
      name: input.name ?? input.id,
      parentBranchId: input.parentBranchId,
      forkedFromEventId: input.forkedFromEventId,
      forkedFromPatchId: input.forkedFromPatchId,
      status: "active",
      createdFor: input.createdFor,
      createdAt: now.toISOString(),
      metadata: input.metadata
    };
    this.store.putBranch(branch);
    return branch;
  }

  proposePatch(input: { patch: ContinuityPatch; ops: ContinuityPatchOp[] }): ContinuityPatch {
    return proposePatch(this.store, input.patch, input.ops);
  }

  acceptPatch(patchId: string, decidedBy: string, now = new Date()): ContinuityPatch {
    const result = acceptPatch(this.store, patchId, decidedBy, now);
    if (result.change) this.publish(result.change);
    return result.patch;
  }

  rejectPatch(patchId: string, decidedBy: string, now = new Date()): ContinuityPatch {
    return rejectPatch(this.store, patchId, decidedBy, now);
  }

  appendEvent(event: AgentSessionEvent, branchId = this.defaultBranchId, now = new Date()): ContinuityPatch[] {
    const accepted: ContinuityPatch[] = [];
    this.store.transaction(() => {
      for (const projector of this.projectors) {
        const offset = this.store.getProjectionOffset(branchId, projectorId(projector));
        if (event.sequence <= offset) continue;
        for (const projection of projector.project(event, { branchId, now })) {
          proposePatch(this.store, projection.patch, projection.ops);
          if (projection.autoAccept) {
            const result = acceptPatch(this.store, projection.patch.id, projectorId(projector), now);
            accepted.push(result.patch);
            if (result.change) this.publish(result.change);
          }
        }
        this.store.setProjectionOffset(branchId, projectorId(projector), event.sequence);
      }
    });
    return accepted;
  }

  async runBehaviors(change: ContinuityGraphChange, now = new Date()): Promise<ContinuityPatch[]> {
    const proposed: ContinuityPatch[] = [];
    for (const behavior of this.behaviors) {
      for (const result of await behavior.evaluate(change, { store: this.store, now })) {
        proposed.push(proposePatch(this.store, result.patch, result.ops));
      }
    }
    return proposed;
  }

  subscribe(listener: (change: ContinuityGraphChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(change: ContinuityGraphChange): void {
    for (const listener of this.listeners) listener(change);
    void this.runBehaviors(change).catch((error) => {
      setTimeout(() => {
        throw error;
      }, 0);
    });
  }
}

function projectorId(projector: ContinuityProjector): string {
  return projector instanceof CoreContinuityProjector ? CORE_PROJECTOR_ID : projector.constructor.name;
}
