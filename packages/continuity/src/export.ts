import { readFileSync, writeFileSync } from "node:fs";
import { EventSourcedGraph } from "./event-graph.js";
import type { ContinuityEvent, EventSourcedGraphStore, GraphSnapshot } from "./event-graph-types.js";

export const CONTINUITY_RUN_EXPORT_SCHEMA = "exocortex.continuity.run_export.v1";

export interface ContinuityRunExport {
  schemaVersion: typeof CONTINUITY_RUN_EXPORT_SCHEMA;
  exportedAt: string;
  runId: string;
  summary: {
    eventCount: number;
    objectCount: number;
    relationCount: number;
    patchCount: number;
    frameCount: number;
  };
  events: ContinuityEvent[];
  snapshot: GraphSnapshot;
}

export interface ContinuityRunExportFilter {
  objectTypes?: string[];
  eventTypes?: string[];
  recentEvents?: number;
  relationTypes?: string[];
  sessionIds?: string[];
  modalityKeys?: string[];
  frameIds?: string[];
  createdAfter?: string;
  createdBefore?: string;
  objectData?: Record<string, string | number | boolean>;
}

export function exportContinuityRun(graph: EventSourcedGraph, now = new Date(), filter: ContinuityRunExportFilter = {}): ContinuityRunExport {
  const snapshot = filteredSnapshot(graph.snapshot(), filter);
  return {
    schemaVersion: CONTINUITY_RUN_EXPORT_SCHEMA,
    exportedAt: now.toISOString(),
    runId: graph.runId,
    summary: {
      eventCount: snapshot.events.length,
      objectCount: snapshot.objects.length,
      relationCount: snapshot.relations.length,
      patchCount: snapshot.patches.length,
      frameCount: snapshot.frames.length
    },
    events: snapshot.events,
    snapshot
  };
}

export function exportContinuityRunFromStore(store: EventSourcedGraphStore, runId: string, now = new Date(), filter: ContinuityRunExportFilter = {}): ContinuityRunExport {
  return exportContinuityRun(new EventSourcedGraph({ runId, store }), now, filter);
}

export function writeContinuityRunExport(path: string, value: ContinuityRunExport): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readContinuityRunExport(path: string): ContinuityRunExport {
  const value = JSON.parse(readFileSync(path, "utf8")) as ContinuityRunExport;
  validateContinuityRunExport(value);
  return value;
}

export function validateContinuityRunExport(value: ContinuityRunExport): void {
  if (value.schemaVersion !== CONTINUITY_RUN_EXPORT_SCHEMA) throw new Error(`Unsupported continuity export schema: ${value.schemaVersion}`);
  if (value.runId !== value.snapshot.runId) throw new Error(`Continuity export runId mismatch: ${value.runId} !== ${value.snapshot.runId}`);
  if (value.summary.eventCount !== value.events.length) throw new Error("Continuity export event count does not match events length");
  if (value.summary.objectCount !== value.snapshot.objects.length) throw new Error("Continuity export object count does not match snapshot");
  if (value.summary.relationCount !== value.snapshot.relations.length) throw new Error("Continuity export relation count does not match snapshot");
  if (value.summary.patchCount !== value.snapshot.patches.length) throw new Error("Continuity export patch count does not match snapshot");
  if (value.summary.frameCount !== value.snapshot.frames.length) throw new Error("Continuity export frame count does not match snapshot");
}

function filteredSnapshot(snapshot: GraphSnapshot, filter: ContinuityRunExportFilter): GraphSnapshot {
  const objectTypes = new Set(filter.objectTypes ?? []);
  const eventTypes = new Set(filter.eventTypes ?? []);
  const relationTypes = new Set(filter.relationTypes ?? []);
  const sessionIds = new Set(filter.sessionIds ?? []);
  const modalityKeys = new Set(filter.modalityKeys ?? []);
  const frameIds = new Set(filter.frameIds ?? []);
  const createdAfter = filter.createdAfter ? Date.parse(filter.createdAfter) : undefined;
  const createdBefore = filter.createdBefore ? Date.parse(filter.createdBefore) : undefined;
  const objects = snapshot.objects.filter((object) => {
    if (objectTypes.size && !objectTypes.has(object.type)) return false;
    if (!withinTimeWindow(object.provenance.createdAt, createdAfter, createdBefore)) return false;
    if (sessionIds.size && !matchesAnyDataValue(object.data, "sessionId", sessionIds)) return false;
    if (modalityKeys.size && !matchesAnyDataValue(object.data, "modalityKey", modalityKeys) && !matchesAnyDataValue(object.data, "key", modalityKeys)) return false;
    if (filter.objectData && !matchesObjectData(object.data, filter.objectData)) return false;
    return true;
  });
  const objectIds = new Set(objects.map((object) => object.id));
  const events = snapshot.events
    .filter((event) => {
      if (eventTypes.size && !eventTypes.has(event.type)) return false;
      if (!withinTimeWindow(event.createdAt, createdAfter, createdBefore)) return false;
      if (sessionIds.size && !matchesAnyDataValue(event.payload, "sessionId", sessionIds)) return false;
      if (modalityKeys.size && !matchesAnyDataValue(event.payload, "modalityKey", modalityKeys) && !matchesAnyDataValue(event.payload, "key", modalityKeys)) return false;
      if (frameIds.size && !matchesAnyDataValue(event.payload, "frameId", frameIds)) return false;
      return true;
    })
    .slice(-(filter.recentEvents ?? snapshot.events.length));
  return {
    ...snapshot,
    objects,
    relations: snapshot.relations.filter((relation) => {
      if (relationTypes.size && !relationTypes.has(relation.type)) return false;
      if (!withinTimeWindow(relation.provenance.createdAt, createdAfter, createdBefore)) return false;
      return objectTypes.size || sessionIds.size || modalityKeys.size || filter.objectData
        ? objectIds.has(relation.sourceId) && objectIds.has(relation.targetId)
        : true;
    }),
    frames: snapshot.frames.filter((frame) => {
      if (frameIds.size && !frameIds.has(frame.id)) return false;
      return withinTimeWindow(frame.createdAt, createdAfter, createdBefore);
    }),
    events
  };
}

function withinTimeWindow(value: string, createdAfter?: number, createdBefore?: number): boolean {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return true;
  if (createdAfter !== undefined && timestamp < createdAfter) return false;
  if (createdBefore !== undefined && timestamp > createdBefore) return false;
  return true;
}

function matchesAnyDataValue(data: Record<string, unknown>, key: string, values: ReadonlySet<string>): boolean {
  const value = data[key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return values.has(String(value));
  return false;
}

function matchesObjectData(data: Record<string, unknown>, expected: Record<string, string | number | boolean>): boolean {
  return Object.entries(expected).every(([key, value]) => data[key] === value || String(data[key]) === String(value));
}
