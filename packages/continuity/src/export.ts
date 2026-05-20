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
  const objects = objectTypes.size ? snapshot.objects.filter((object) => objectTypes.has(object.type)) : snapshot.objects;
  const objectIds = new Set(objects.map((object) => object.id));
  const events = (eventTypes.size ? snapshot.events.filter((event) => eventTypes.has(event.type)) : snapshot.events).slice(-(filter.recentEvents ?? snapshot.events.length));
  return {
    ...snapshot,
    objects,
    relations: objectTypes.size ? snapshot.relations.filter((relation) => objectIds.has(relation.sourceId) && objectIds.has(relation.targetId)) : snapshot.relations,
    events
  };
}
