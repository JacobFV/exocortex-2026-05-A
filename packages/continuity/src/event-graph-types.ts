export const MAIN_RUN_ID = "main";

export interface ContinuityEvent {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  actor?: string;
  frameId?: string;
  causedBy?: string;
  createdAt: string;
}

export interface GraphProvenance {
  createdBy: string;
  causedByEventId?: string;
  frameId?: string;
  createdAt: string;
  evidenceEventIds: string[];
}

export interface GraphObject {
  id: string;
  type: string;
  data: Record<string, unknown>;
  version: number;
  removed?: boolean;
  provenance: GraphProvenance;
}

export interface GraphRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  data: Record<string, unknown>;
  removed?: boolean;
  provenance: GraphProvenance;
}

export interface GraphPatch {
  id: string;
  targetObjectId: string;
  expectedVersion: number;
  updates: Record<string, unknown>;
  status: "proposed" | "applied" | "rejected";
  proposedBy: string;
  reason?: string;
  rejectionReason?: string;
  provenance: GraphProvenance;
}

export interface GraphFrame {
  id: string;
  goal: string;
  constraints: Record<string, unknown>;
  budget: Record<string, unknown>;
  behaviorNames: string[];
  createdAt: string;
}

export interface GraphViewSpec {
  aroundObjectId?: string | string[];
  depth?: number;
  includeTypes?: string[];
  recentEvents?: number;
}

export interface GraphSnapshot {
  runId: string;
  objects: GraphObject[];
  relations: GraphRelation[];
  patches: GraphPatch[];
  frames: GraphFrame[];
  events: ContinuityEvent[];
}

export interface EventSourcedGraphStore {
  appendEvent(event: ContinuityEvent): void;
  listEvents(runId: string): ContinuityEvent[];
  listRuns(): string[];
  transaction<T>(fn: () => T): T;
}
