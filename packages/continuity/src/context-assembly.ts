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
  runtimePolicy?: RuntimeModelContextPolicy;
  retention?: GraphContextRetentionPolicy;
}

export interface RuntimeModelContextPolicy {
  runtimeKey?: string;
  provider?: string;
  model?: string;
  contextWindowTokens?: number;
  reservedOutputTokens?: number;
  targetInputTokens?: number;
  characterBudget?: number;
  detail?: "full" | "balanced" | "compact";
}

export interface GraphContextRetentionPolicy {
  maxSessions?: number;
  maxGoals?: number;
  maxModalities?: number;
  maxCapabilities?: number;
  maxFrames?: number;
  maxOpenTasks?: number;
  maxFailures?: number;
  maxSafety?: number;
  maxCalibrationProfiles?: number;
  maxRecentObjects?: number;
  maxRelations?: number;
  maxRecentEvents?: number;
  maxObjectDataStringLength?: number;
  maxEventPayloadStringLength?: number;
}

export interface GraphContextCompactionReport {
  originalCounts: Record<string, number>;
  retainedCounts: Record<string, number>;
  omittedCounts: Record<string, number>;
  characterBudget?: number;
  compactedStrings: number;
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
  runtimePolicy?: RuntimeModelContextPolicy;
  compaction: GraphContextCompactionReport;
}

export function assembleGraphContext(graph: EventSourcedGraph, spec: GraphContextSpec = {}): AssembledGraphContext {
  const snapshot = graph.snapshot();
  const runtimePolicy = spec.runtimePolicy;
  const retention = retentionLimits(spec);
  let compactedStrings = 0;
  const byType = (type: string) => snapshot.objects.filter((object) => object.type === type);
  const sessions = newestFirst(byType("agent_session").filter((object) => !spec.sessionId || object.data.sessionId === spec.sessionId));
  const goals = newestFirst(byType("goal").filter((object) => {
    if (spec.sessionId && object.data.sessionId !== spec.sessionId) return false;
    if (spec.goalText && typeof object.data.text === "string" && !object.data.text.toLowerCase().includes(spec.goalText.toLowerCase())) return false;
    return true;
  }));
  const modalities = newestFirst(byType("modality").filter((object) => !spec.modalityKey || object.data.key === spec.modalityKey));
  const capabilityKinds = new Set(spec.capabilityKinds ?? []);
  const capabilities = newestFirst(byType("capability").filter((object) => !capabilityKinds.size || capabilityKinds.has(String(object.data.capabilityKind ?? object.data.kind ?? ""))));
  const frames = newestFrames(snapshot.frames.filter((frame) => !spec.frameId || frame.id === spec.frameId));
  const safety = newestFirst(snapshot.objects.filter((object) => object.type === "safety_grant" || object.type === "safety_denial" || (object.type === "policy" && object.data.policyKind === "safety")));
  const includeTypes = new Set(spec.includeObjectTypes ?? []);
  const scopedIds = new Set([...sessions, ...goals, ...modalities, ...capabilities].map((object) => object.id));
  const scopedRelations = newestRelations(snapshot.relations.filter((relation) => !scopedIds.size || scopedIds.has(relation.sourceId) || scopedIds.has(relation.targetId)));
  const relatedIds = new Set(scopedRelations.flatMap((relation) => [relation.sourceId, relation.targetId]));
  const recentObjectCandidates = snapshot.objects
    .filter((object) => (!includeTypes.size || includeTypes.has(object.type)) && (!scopedIds.size || scopedIds.has(object.id) || relatedIds.has(object.id)))
    .sort((a, b) => Date.parse(b.provenance.createdAt) - Date.parse(a.provenance.createdAt));
  const recentObjects = recentObjectCandidates.slice(0, retention.maxRecentObjects);
  const openTasks = newestFirst(byType("task").filter((object) => object.data.status !== "completed" && object.data.status !== "cancelled"));
  const failures = newestFirst(byType("failure"));
  const calibrationProfiles = newestFirst(byType("calibration_profile").filter((object) => object.data.active !== false));
  const recentEventCandidates = snapshot.events;
  const recentEvents = recentEventCandidates.slice(-retention.maxRecentEvents);
  const originalCounts = {
    sessions: sessions.length,
    goals: goals.length,
    modalities: modalities.length,
    capabilities: capabilities.length,
    frames: frames.length,
    openTasks: openTasks.length,
    failures: failures.length,
    safety: safety.length,
    calibrationProfiles: calibrationProfiles.length,
    recentObjects: recentObjectCandidates.length,
    relations: scopedRelations.length,
    recentEvents: recentEventCandidates.length
  };
  const objectStringLimit = dataStringLimit(runtimePolicy, retention.maxObjectDataStringLength);
  const eventStringLimit = dataStringLimit(runtimePolicy, retention.maxEventPayloadStringLength);
  const compactObject = (object: GraphObject): GraphObject => compactGraphObject(object, objectStringLimit, () => {
    compactedStrings += 1;
  });
  const compactRelation = (relation: GraphRelation): GraphRelation => compactGraphRelation(relation, objectStringLimit, () => {
    compactedStrings += 1;
  });
  const compactEvent = (event: ContinuityEvent): ContinuityEvent => compactContinuityEvent(event, eventStringLimit, () => {
    compactedStrings += 1;
  });
  const retained = {
    sessions: retain(sessions, retention.maxSessions).map(compactObject),
    goals: retain(goals, retention.maxGoals).map(compactObject),
    modalities: retain(modalities, retention.maxModalities).map(compactObject),
    capabilities: retain(capabilities, retention.maxCapabilities).map(compactObject),
    frames: retain(frames, retention.maxFrames),
    openTasks: retain(openTasks, retention.maxOpenTasks).map(compactObject),
    failures: retain(failures, retention.maxFailures).map(compactObject),
    safety: retain(safety, retention.maxSafety).map(compactObject),
    calibrationProfiles: retain(calibrationProfiles, retention.maxCalibrationProfiles).map(compactObject),
    recentObjects: recentObjects.map(compactObject),
    relations: retain(scopedRelations, retention.maxRelations).map(compactRelation),
    recentEvents: recentEvents.map(compactEvent)
  };
  const retainedCounts = {
    sessions: retained.sessions.length,
    goals: retained.goals.length,
    modalities: retained.modalities.length,
    capabilities: retained.capabilities.length,
    frames: retained.frames.length,
    openTasks: retained.openTasks.length,
    failures: retained.failures.length,
    safety: retained.safety.length,
    calibrationProfiles: retained.calibrationProfiles.length,
    recentObjects: retained.recentObjects.length,
    relations: retained.relations.length,
    recentEvents: retained.recentEvents.length
  };

  const omittedCounts: Record<string, number> = {};
  for (const key of Object.keys(originalCounts) as Array<keyof typeof originalCounts>) {
    omittedCounts[key] = Math.max(0, originalCounts[key] - retainedCounts[key]);
  }

  return {
    runId: graph.runId,
    scope: spec,
    sessions: retained.sessions,
    goals: retained.goals,
    modalities: retained.modalities,
    capabilities: retained.capabilities,
    frames: retained.frames,
    openTasks: retained.openTasks,
    failures: retained.failures,
    safety: retained.safety,
    calibrationProfiles: retained.calibrationProfiles,
    recentObjects: retained.recentObjects,
    relations: retained.relations,
    recentEvents: retained.recentEvents,
    runtimePolicy,
    compaction: {
      originalCounts,
      retainedCounts,
      omittedCounts,
      characterBudget: resolveCharacterBudget(runtimePolicy),
      compactedStrings
    }
  };
}

export function renderGraphContextForPrompt(context: AssembledGraphContext): string {
  const payload = {
    runId: context.runId,
    scope: context.scope,
    runtimePolicy: context.runtimePolicy,
    compaction: context.compaction,
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
    recentObjects: context.recentObjects.map((object) => ({
      id: object.id,
      type: object.type,
      data: object.data,
      createdAt: object.provenance.createdAt
    })),
    relations: context.relations.map((relation) => ({
      sourceId: relation.sourceId,
      targetId: relation.targetId,
      type: relation.type,
      data: relation.data
    })),
    recentEvents: context.recentEvents.map((event) => ({
      type: event.type,
      sequence: event.sequence,
      createdAt: event.createdAt,
      payload: event.payload
    }))
  };
  return JSON.stringify(compactPromptPayload(payload, resolveCharacterBudget(context.runtimePolicy)));
}

interface ResolvedRetentionPolicy {
  maxSessions?: number;
  maxGoals?: number;
  maxModalities?: number;
  maxCapabilities?: number;
  maxFrames?: number;
  maxOpenTasks?: number;
  maxFailures?: number;
  maxSafety?: number;
  maxCalibrationProfiles?: number;
  maxRecentObjects: number;
  maxRelations?: number;
  maxRecentEvents: number;
  maxObjectDataStringLength?: number;
  maxEventPayloadStringLength?: number;
}

function retentionLimits(spec: GraphContextSpec): ResolvedRetentionPolicy {
  const runtimeDefaults = retentionDefaultsForRuntime(spec.runtimePolicy);
  return {
    ...runtimeDefaults,
    ...spec.retention,
    maxRecentObjects: spec.retention?.maxRecentObjects ?? runtimeDefaults.maxRecentObjects ?? 80,
    maxRecentEvents: spec.retention?.maxRecentEvents ?? spec.recentEvents ?? runtimeDefaults.maxRecentEvents ?? 40
  };
}

function retentionDefaultsForRuntime(policy: RuntimeModelContextPolicy | undefined): Partial<ResolvedRetentionPolicy> {
  if (policy?.detail === "compact") {
    return {
      maxGoals: 3,
      maxModalities: 6,
      maxCapabilities: 12,
      maxOpenTasks: 12,
      maxFailures: 8,
      maxSafety: 8,
      maxCalibrationProfiles: 6,
      maxRecentObjects: 24,
      maxRelations: 48,
      maxRecentEvents: 12,
      maxObjectDataStringLength: 240,
      maxEventPayloadStringLength: 240
    };
  }
  if (policy?.detail === "balanced") {
    return {
      maxOpenTasks: 32,
      maxFailures: 16,
      maxSafety: 16,
      maxRecentObjects: 48,
      maxRelations: 96,
      maxRecentEvents: 24,
      maxObjectDataStringLength: 800,
      maxEventPayloadStringLength: 800
    };
  }
  return {};
}

function retain<T>(values: T[], max: number | undefined): T[] {
  if (max === undefined) return values;
  return values.slice(0, Math.max(0, max));
}

function newestFirst(objects: GraphObject[]): GraphObject[] {
  return [...objects].sort((a, b) => Date.parse(b.provenance.createdAt) - Date.parse(a.provenance.createdAt));
}

function newestRelations(relations: GraphRelation[]): GraphRelation[] {
  return [...relations].sort((a, b) => Date.parse(b.provenance.createdAt) - Date.parse(a.provenance.createdAt));
}

function newestFrames(frames: GraphFrame[]): GraphFrame[] {
  return [...frames].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function dataStringLimit(policy: RuntimeModelContextPolicy | undefined, explicit: number | undefined): number | undefined {
  if (explicit !== undefined) return explicit;
  if (policy?.detail === "compact") return 240;
  if (policy?.detail === "balanced") return 800;
  return undefined;
}

function compactGraphObject(object: GraphObject, maxStringLength: number | undefined, onCompact: () => void): GraphObject {
  if (maxStringLength === undefined) return object;
  return { ...object, data: compactRecord(object.data, maxStringLength, onCompact) };
}

function compactGraphRelation(relation: GraphRelation, maxStringLength: number | undefined, onCompact: () => void): GraphRelation {
  if (maxStringLength === undefined) return relation;
  return { ...relation, data: compactRecord(relation.data, maxStringLength, onCompact) };
}

function compactContinuityEvent(event: ContinuityEvent, maxStringLength: number | undefined, onCompact: () => void): ContinuityEvent {
  if (maxStringLength === undefined) return event;
  return { ...event, payload: compactRecord(event.payload, maxStringLength, onCompact) };
}

function compactRecord(value: Record<string, unknown>, maxStringLength: number, onCompact: () => void): Record<string, unknown> {
  return compactValue(value, maxStringLength, onCompact) as Record<string, unknown>;
}

function compactValue(value: unknown, maxStringLength: number, onCompact: () => void): unknown {
  if (typeof value === "string" && value.length > maxStringLength) {
    onCompact();
    return `${value.slice(0, maxStringLength)}... [truncated ${value.length - maxStringLength} chars]`;
  }
  if (Array.isArray(value)) return value.map((item) => compactValue(item, maxStringLength, onCompact));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, compactValue(nested, maxStringLength, onCompact)]));
  }
  return value;
}

function resolveCharacterBudget(policy: RuntimeModelContextPolicy | undefined): number | undefined {
  if (!policy) return undefined;
  if (policy.characterBudget !== undefined) return Math.max(0, policy.characterBudget);
  if (policy.targetInputTokens !== undefined) return Math.max(0, policy.targetInputTokens * 4);
  if (policy.contextWindowTokens !== undefined) return Math.max(0, (policy.contextWindowTokens - (policy.reservedOutputTokens ?? 0)) * 4);
  return undefined;
}

function compactPromptPayload(payload: Record<string, unknown>, characterBudget: number | undefined): Record<string, unknown> {
  if (characterBudget === undefined || JSON.stringify(payload).length <= characterBudget) return payload;
  const compacted = structuredClone(payload) as Record<string, unknown>;
  for (const key of ["recentEvents", "recentObjects", "relations", "failures", "openTasks"]) {
    while (Array.isArray(compacted[key]) && compacted[key].length > 0 && JSON.stringify(compacted).length > characterBudget) {
      compacted[key].pop();
    }
  }
  if (JSON.stringify(compacted).length > characterBudget) {
    compacted.budgetExceeded = true;
  }
  return compacted;
}
