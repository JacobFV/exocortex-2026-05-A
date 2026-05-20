import { GraphIdGenerator, createRunId } from "./event-graph-ids.js";
import type {
  ContinuityEvent,
  EventSourcedGraphStore,
  GraphFrame,
  GraphObject,
  GraphPatch,
  GraphProvenance,
  GraphRelation,
  GraphSnapshot,
  GraphViewSpec
} from "./event-graph-types.js";

export interface EventGraphOptions {
  runId?: string;
  store?: EventSourcedGraphStore;
  clock?: () => Date;
}

export class EventSourcedGraph {
  readonly runId: string;
  readonly ids: GraphIdGenerator;
  private sequence = 0;
  private readonly objects = new Map<string, GraphObject>();
  private readonly relations = new Map<string, GraphRelation>();
  private readonly patches = new Map<string, GraphPatch>();
  private readonly frames = new Map<string, GraphFrame>();
  private readonly events: ContinuityEvent[] = [];
  private readonly listeners = new Set<(event: ContinuityEvent) => void>();
  private readonly clock: () => Date;

  constructor(private readonly options: EventGraphOptions = {}) {
    this.runId = options.runId ?? createRunId();
    this.ids = new GraphIdGenerator(this.runId);
    this.clock = options.clock ?? (() => new Date());
    const stored = options.store?.listEvents(this.runId) ?? [];
    for (const event of stored) this.replayEvent(event);
  }

  static replay(events: ContinuityEvent[], options: Omit<EventGraphOptions, "runId"> & { runId: string }): EventSourcedGraph {
    const graph = new EventSourcedGraph({ ...options, store: undefined });
    for (const event of events) graph.replayEvent(event);
    return graph;
  }

  subscribe(listener: (event: ContinuityEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type: string, payload: Record<string, unknown>, input: { actor?: string; frameId?: string; causedBy?: string; createdAt?: Date } = {}): ContinuityEvent {
    const event: ContinuityEvent = {
      id: this.ids.next("evt"),
      runId: this.runId,
      sequence: this.sequence + 1,
      type,
      payload: structuredClone(payload),
      actor: input.actor,
      frameId: input.frameId,
      causedBy: input.causedBy,
      createdAt: (input.createdAt ?? this.clock()).toISOString()
    };
    if (this.options.store) {
      this.options.store.transaction(() => {
        this.options.store?.appendEvent(event);
        this.applyEvent(event);
      });
    } else {
      this.applyEvent(event);
    }
    for (const listener of this.listeners) listener(event);
    return event;
  }

  replayEvent(event: ContinuityEvent): void {
    this.applyEvent(structuredClone(event));
  }

  addObject(type: string, data: Record<string, unknown>, input: { id?: string; actor?: string; frameId?: string; causedBy?: string; createdAt?: Date } = {}): GraphObject {
    const object: GraphObject = {
      id: input.id ?? this.ids.next("obj"),
      type,
      data: stripProvenance(data),
      version: 1,
      provenance: provenance(input.actor, input.causedBy, input.frameId, (input.createdAt ?? this.clock()).toISOString())
    };
    this.emit("object.created", { object }, input);
    return object;
  }

  patchObject(objectId: string, updates: Record<string, unknown>, input: { actor?: string; frameId?: string; causedBy?: string; createdAt?: Date; reason?: string } = {}): GraphPatch {
    const object = this.requireObject(objectId);
    const patch = this.proposePatch(objectId, object.version, updates, input);
    this.applyPatch(patch.id, input);
    return this.patches.get(patch.id) ?? patch;
  }

  proposePatch(objectId: string, expectedVersion: number, updates: Record<string, unknown>, input: { actor?: string; frameId?: string; causedBy?: string; createdAt?: Date; reason?: string } = {}): GraphPatch {
    const createdAt = (input.createdAt ?? this.clock()).toISOString();
    const patch: GraphPatch = {
      id: this.ids.next("patch"),
      targetObjectId: objectId,
      expectedVersion,
      updates: stripProvenance(updates),
      status: "proposed",
      proposedBy: input.actor ?? "system",
      reason: input.reason,
      provenance: provenance(input.actor, input.causedBy, input.frameId, createdAt)
    };
    this.emit("patch.proposed", { patch }, { ...input, createdAt: new Date(createdAt) });
    return patch;
  }

  applyPatch(patchId: string, input: { actor?: string; frameId?: string; causedBy?: string; createdAt?: Date } = {}): GraphPatch {
    const patch = this.requirePatch(patchId);
    if (patch.status !== "proposed") throw new Error(`Patch is already terminal: ${patchId}`);
    const target = this.requireObject(patch.targetObjectId);
    if (target.version !== patch.expectedVersion) {
      return this.rejectPatch(patchId, `version mismatch: expected ${patch.expectedVersion}, got ${target.version}`, input);
    }
    const applied: GraphPatch = { ...patch, status: "applied" };
    this.emit("patch.applied", { patch: applied, objectId: target.id, updates: patch.updates, version: target.version + 1 }, input);
    return applied;
  }

  rejectPatch(patchId: string, reason: string, input: { actor?: string; frameId?: string; causedBy?: string; createdAt?: Date } = {}): GraphPatch {
    const patch = this.requirePatch(patchId);
    if (patch.status !== "proposed") throw new Error(`Patch is already terminal: ${patchId}`);
    const rejected: GraphPatch = { ...patch, status: "rejected", rejectionReason: reason };
    this.emit("patch.rejected", { patch: rejected, reason }, input);
    return rejected;
  }

  addRelation(sourceId: string, targetId: string, type: string, data: Record<string, unknown> = {}, input: { id?: string; actor?: string; frameId?: string; causedBy?: string; createdAt?: Date } = {}): GraphRelation {
    this.requireObject(sourceId);
    this.requireObject(targetId);
    const relation: GraphRelation = {
      id: input.id ?? this.ids.next("rel"),
      sourceId,
      targetId,
      type,
      data: stripProvenance(data),
      provenance: provenance(input.actor, input.causedBy, input.frameId, (input.createdAt ?? this.clock()).toISOString())
    };
    this.emit("relation.created", { relation }, input);
    return relation;
  }

  createFrame(goal: string, input: { id?: string; constraints?: Record<string, unknown>; budget?: Record<string, unknown>; behaviorNames?: string[]; actor?: string; causedBy?: string; createdAt?: Date } = {}): GraphFrame {
    const frame: GraphFrame = {
      id: input.id ?? this.ids.next("frame"),
      goal,
      constraints: input.constraints ?? {},
      budget: input.budget ?? {},
      behaviorNames: input.behaviorNames ?? [],
      createdAt: (input.createdAt ?? this.clock()).toISOString()
    };
    this.emit("frame.created", { frame }, input);
    return frame;
  }

  getObject(id: string): GraphObject | undefined {
    const object = this.objects.get(id);
    return object && !object.removed ? structuredClone(object) : undefined;
  }

  getRelation(id: string): GraphRelation | undefined {
    const relation = this.relations.get(id);
    return relation && !relation.removed ? structuredClone(relation) : undefined;
  }

  findObjects(query: { type?: string; where?: Record<string, unknown> } = {}): GraphObject[] {
    return [...this.objects.values()]
      .filter((object) => !object.removed)
      .filter((object) => !query.type || object.type === query.type)
      .filter((object) => !query.where || matchesWhere(object.data, query.where))
      .map((object) => structuredClone(object));
  }

  findRelations(query: { sourceId?: string; targetId?: string; type?: string } = {}): GraphRelation[] {
    return [...this.relations.values()]
      .filter((relation) => !relation.removed)
      .filter((relation) => !query.sourceId || relation.sourceId === query.sourceId)
      .filter((relation) => !query.targetId || relation.targetId === query.targetId)
      .filter((relation) => !query.type || relation.type === query.type)
      .map((relation) => structuredClone(relation));
  }

  view(spec: GraphViewSpec = {}): GraphSnapshot {
    const depth = spec.depth ?? 0;
    const includeTypes = new Set(spec.includeTypes ?? []);
    const centers = new Set(typeof spec.aroundObjectId === "string" ? [spec.aroundObjectId] : spec.aroundObjectId ?? []);
    const included = new Set<string>(centers);
    let frontier = new Set(centers);
    for (let i = 0; i < depth; i += 1) {
      const next = new Set<string>();
      for (const relation of this.findRelations()) {
        if (frontier.has(relation.sourceId)) next.add(relation.targetId);
        if (frontier.has(relation.targetId)) next.add(relation.sourceId);
      }
      for (const id of next) included.add(id);
      frontier = next;
    }
    const fullGraph = included.size === 0;
    const objects = this.findObjects().filter((object) => (fullGraph || included.has(object.id)) && (!includeTypes.size || includeTypes.has(object.type)));
    const objectIds = new Set(objects.map((object) => object.id));
    return {
      runId: this.runId,
      objects,
      relations: this.findRelations().filter((relation) => objectIds.has(relation.sourceId) && objectIds.has(relation.targetId)),
      patches: [...this.patches.values()].map((patch) => structuredClone(patch)),
      frames: [...this.frames.values()].map((frame) => structuredClone(frame)),
      events: this.events.slice(-(spec.recentEvents ?? this.events.length)).map((event) => structuredClone(event))
    };
  }

  snapshot(): GraphSnapshot {
    return this.view();
  }

  private applyEvent(event: ContinuityEvent): void {
    if (this.events.some((candidate) => candidate.id === event.id)) return;
    this.ids.observe(event.id);
    this.sequence = Math.max(this.sequence, event.sequence);
    this.events.push(event);
    switch (event.type) {
      case "object.created": {
        const object = requirePayload<GraphObject>(event, "object");
        this.ids.observe(object.id);
        this.objects.set(object.id, structuredClone(object));
        break;
      }
      case "object.removed": {
        const objectId = requireString(event.payload.objectId, "objectId");
        const object = this.objects.get(objectId);
        if (object) this.objects.set(objectId, { ...object, removed: true });
        break;
      }
      case "relation.created": {
        const relation = requirePayload<GraphRelation>(event, "relation");
        this.ids.observe(relation.id);
        this.relations.set(relation.id, structuredClone(relation));
        break;
      }
      case "relation.removed": {
        const relationId = requireString(event.payload.relationId, "relationId");
        const relation = this.relations.get(relationId);
        if (relation) this.relations.set(relationId, { ...relation, removed: true });
        break;
      }
      case "patch.proposed": {
        const patch = requirePayload<GraphPatch>(event, "patch");
        this.ids.observe(patch.id);
        this.patches.set(patch.id, structuredClone(patch));
        break;
      }
      case "patch.applied": {
        const patch = requirePayload<GraphPatch>(event, "patch");
        const objectId = requireString(event.payload.objectId, "objectId");
        const version = Number(event.payload.version);
        const updates = requireRecord(event.payload.updates, "updates");
        const object = this.requireObject(objectId);
        this.patches.set(patch.id, structuredClone(patch));
        this.objects.set(objectId, { ...object, data: { ...object.data, ...stripProvenance(updates) }, version });
        break;
      }
      case "patch.rejected": {
        const patch = requirePayload<GraphPatch>(event, "patch");
        this.patches.set(patch.id, structuredClone(patch));
        break;
      }
      case "frame.created": {
        const frame = requirePayload<GraphFrame>(event, "frame");
        this.ids.observe(frame.id);
        this.frames.set(frame.id, structuredClone(frame));
        break;
      }
    }
  }

  private requireObject(id: string): GraphObject {
    const object = this.objects.get(id);
    if (!object || object.removed) throw new Error(`Unknown graph object: ${id}`);
    return object;
  }

  private requirePatch(id: string): GraphPatch {
    const patch = this.patches.get(id);
    if (!patch) throw new Error(`Unknown graph patch: ${id}`);
    return patch;
  }
}

function provenance(actor = "system", causedByEventId: string | undefined, frameId: string | undefined, createdAt: string): GraphProvenance {
  return { createdBy: actor, causedByEventId, frameId, createdAt, evidenceEventIds: causedByEventId ? [causedByEventId] : [] };
}

function stripProvenance(data: Record<string, unknown>): Record<string, unknown> {
  const { provenance: _provenance, ...rest } = data;
  return structuredClone(rest);
}

function requirePayload<T>(event: ContinuityEvent, key: string): T {
  const value = event.payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Event ${event.type} requires object payload ${key}`);
  return value as T;
}

function requireRecord(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Payload requires object ${key}`);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== "string") throw new Error(`Payload requires string ${key}`);
  return value;
}

function matchesWhere(data: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => data[key] === expected);
}
