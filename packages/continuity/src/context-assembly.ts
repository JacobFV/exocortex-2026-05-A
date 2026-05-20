import { EventSourcedGraph } from "./event-graph.js";
import type { ContinuityEvent, GraphFrame, GraphObject, GraphRelation } from "./event-graph-types.js";

export interface GraphContextSpec {
  sessionId?: string;
  goalText?: string;
  modalityKey?: string;
  frameId?: string;
  capabilityKinds?: string[];
  recentEvents?: number;
  includeObjectTypes?: string[];
}

export interface AssembledGraphContext {
  runId: string;
  scope: GraphContextSpec;
  sessions: GraphObject[];
  goals: GraphObject[];
  modalities: GraphObject[];
  capabilities: GraphObject[];
  frames: GraphFrame[];
  openTasks: GraphObject[];
  failures: GraphObject[];
  safety: GraphObject[];
  calibrationProfiles: GraphObject[];
  recentObjects: GraphObject[];
  relations: GraphRelation[];
  recentEvents: ContinuityEvent[];
}

export function assembleGraphContext(graph: EventSourcedGraph, spec: GraphContextSpec = {}): AssembledGraphContext {
  const snapshot = graph.snapshot();
  const byType = (type: string) => snapshot.objects.filter((object) => object.type === type);
  const sessions = byType("agent_session").filter((object) => !spec.sessionId || object.data.sessionId === spec.sessionId);
  const goals = byType("goal").filter((object) => {
    if (spec.sessionId && object.data.sessionId !== spec.sessionId) return false;
    if (spec.goalText && typeof object.data.text === "string" && !object.data.text.toLowerCase().includes(spec.goalText.toLowerCase())) return false;
    return true;
  });
  const modalities = byType("modality").filter((object) => !spec.modalityKey || object.data.key === spec.modalityKey);
  const capabilityKinds = new Set(spec.capabilityKinds ?? []);
  const capabilities = byType("capability").filter((object) => !capabilityKinds.size || capabilityKinds.has(String(object.data.capabilityKind ?? object.data.kind ?? "")));
  const frames = snapshot.frames.filter((frame) => !spec.frameId || frame.id === spec.frameId);
  const safety = snapshot.objects.filter((object) => object.type === "safety_grant" || object.type === "safety_denial" || (object.type === "policy" && object.data.policyKind === "safety"));
  const includeTypes = new Set(spec.includeObjectTypes ?? []);
  const scopedIds = new Set([...sessions, ...goals, ...modalities, ...capabilities].map((object) => object.id));
  const scopedRelations = snapshot.relations.filter((relation) => !scopedIds.size || scopedIds.has(relation.sourceId) || scopedIds.has(relation.targetId));
  const relatedIds = new Set(scopedRelations.flatMap((relation) => [relation.sourceId, relation.targetId]));
  const recentObjects = snapshot.objects
    .filter((object) => (!includeTypes.size || includeTypes.has(object.type)) && (!scopedIds.size || scopedIds.has(object.id) || relatedIds.has(object.id)))
    .sort((a, b) => Date.parse(b.provenance.createdAt) - Date.parse(a.provenance.createdAt))
    .slice(0, 80);

  return {
    runId: graph.runId,
    scope: spec,
    sessions,
    goals,
    modalities,
    capabilities,
    frames,
    openTasks: byType("task").filter((object) => object.data.status !== "completed" && object.data.status !== "cancelled"),
    failures: byType("failure"),
    safety,
    calibrationProfiles: byType("calibration_profile").filter((object) => object.data.active !== false),
    recentObjects,
    relations: scopedRelations,
    recentEvents: snapshot.events.slice(-(spec.recentEvents ?? 40))
  };
}

export function renderGraphContextForPrompt(context: AssembledGraphContext): string {
  return JSON.stringify({
    runId: context.runId,
    scope: context.scope,
    goals: context.goals.map((object) => object.data),
    modalities: context.modalities.map((object) => object.data),
    capabilities: context.capabilities.map((object) => ({
      kind: object.data.kind,
      capabilityKind: object.data.capabilityKind,
      key: object.data.key,
      enabled: object.data.enabled
    })),
    openTasks: context.openTasks.map((object) => ({
      id: object.id,
      taskKind: object.data.taskKind,
      status: object.data.status,
      reason: object.data.reason
    })),
    failures: context.failures.map((object) => object.data),
    safety: context.safety.map((object) => ({ type: object.type, data: object.data })),
    calibrationProfiles: context.calibrationProfiles.map((object) => ({
      profileId: object.data.profileId,
      deviceKey: object.data.deviceKey,
      profileHash: object.data.profileHash
    })),
    recentEvents: context.recentEvents.map((event) => ({
      type: event.type,
      sequence: event.sequence,
      createdAt: event.createdAt
    }))
  });
}
