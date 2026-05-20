import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent } from "@exocortex/protocol";
import { createDefaultContinuityBehaviors, createDefaultContinuityRelationBehaviors } from "./event-graph-behaviors.js";
import { EventSourcedGraph } from "./event-graph.js";
import { EventGraphKernel } from "./event-graph-kernel.js";
import { InMemoryEventSourcedGraphStore, SQLiteEventSourcedGraphStore } from "./event-graph-store.js";
import { ReactiveGraphRuntime } from "./reactive-runtime.js";

runStorelessGraphContract();
runKernelIdempotencyContract();
await runContinuityBehaviorContract();
await runStoreContract(new InMemoryEventSourcedGraphStore());

const tempRoot = mkdtempSync(join(tmpdir(), "exocortex-event-graph-"));
try {
  const sqlite = new SQLiteEventSourcedGraphStore(join(tempRoot, "graph.db"));
  await runStoreContract(sqlite);
  sqlite.close();
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

async function runStoreContract(store: InMemoryEventSourcedGraphStore | SQLiteEventSourcedGraphStore): Promise<void> {
  const graph = new EventSourcedGraph({ runId: "run_contract", store, clock: fixedClock("2026-05-20T00:00:00.000Z") });
  const frame = graph.createFrame("Evaluate wearable context", { id: "frame_primary", actor: "operator" });
  const task = graph.addObject("task", { title: "Research sensors", status: "open", provenance: { forged: true } }, { actor: "planner", frameId: frame.id });
  const memo = graph.addObject("task", { title: "Draft memo", status: "blocked" }, { actor: "planner", frameId: frame.id });
  const relation = graph.addRelation(task.id, memo.id, "depends_on", {}, { actor: "planner", frameId: frame.id });
  assert.equal(graph.getObject(task.id)?.data.status, "open");
  assert.equal(graph.getObject(task.id)?.data.provenance, undefined);

  const patch = graph.proposePatch(task.id, 1, { status: "completed" }, { actor: "researcher", causedBy: graph.snapshot().events.at(-1)?.id });
  graph.applyPatch(patch.id, { actor: "runtime" });
  assert.equal(graph.getObject(task.id)?.version, 2);
  assert.equal(graph.getObject(task.id)?.data.status, "completed");

  const stalePatch = graph.proposePatch(task.id, 1, { status: "stale" }, { actor: "late_writer" });
  const rejected = graph.applyPatch(stalePatch.id, { actor: "runtime" });
  assert.equal(rejected.status, "rejected");
  assert.equal(graph.getObject(task.id)?.data.status, "completed");

  const replayed = new EventSourcedGraph({ runId: graph.runId, store });
  assert.deepEqual(jsonSnapshot(replayed.snapshot()), jsonSnapshot(graph.snapshot()));

  const scoped = replayed.view({ aroundObjectId: task.id, depth: 1, recentEvents: 3 });
  assert.ok(scoped.objects.some((object) => object.id === memo.id));
  assert.ok(scoped.relations.some((candidate) => candidate.id === relation.id));
  assert.equal(scoped.events.length, 3);

  const runtime = new ReactiveGraphRuntime({
    graph,
    behaviors: [
      {
        name: "claim-indexer",
        on: ["object.created"],
        where: { objectType: "claim" },
        run() {
          throw new Error("not reached");
        }
      },
      {
        name: "failure-is-event",
        on: ["custom.fail"],
        run() {
          throw new Error("behavior body failed");
        }
      }
    ],
    relationBehaviors: [
      {
        name: "unblock-dependents",
        relationType: "depends_on",
        on: ["task.completed"],
        run(edge, context) {
          if (context.event.payload.taskId === edge.sourceId) context.graph.patchObject(edge.targetId, { status: "open" }, { actor: "unblock-dependents", causedBy: context.event.id });
        }
      }
    ]
  });
  graph.emit("task.completed", { taskId: task.id }, { actor: "researcher" });
  await runtime.runUntilIdle();
  assert.equal(graph.getObject(memo.id)?.data.status, "open");

  graph.emit("custom.fail", {}, { actor: "test" });
  await runtime.runUntilIdle();
  assert.ok(graph.snapshot().events.some((event) => event.type === "behavior.failed" && event.payload.behaviorName === "failure-is-event"));
  runtime.close();
}

function runStorelessGraphContract(): void {
  const graph = new EventSourcedGraph({ runId: "run_storeless", clock: fixedClock("2026-05-20T00:00:00.000Z") });
  const object = graph.addObject("claim", { text: "events apply without a backing store" }, { actor: "test" });
  assert.equal(graph.getObject(object.id)?.data.text, "events apply without a backing store");
  assert.equal(graph.snapshot().events.length, 1);
}

function runKernelIdempotencyContract(): void {
  const graph = new EventSourcedGraph({ runId: "run_kernel_idempotency", store: new InMemoryEventSourcedGraphStore(), clock: fixedClock("2026-05-20T00:00:00.000Z") });
  const kernel = new EventGraphKernel({ graph });
  const event: AgentSessionEvent = {
    id: "evt_source_1" as AgentSessionEvent["id"],
    sessionId: "sess_source_1" as AgentSessionEvent["sessionId"],
    sequence: 1,
    createdAt: "2026-05-20T00:00:00.000Z",
    type: "session.created",
    goal: "Project once",
    runtime: { provider: "local", model: "local-rules" }
  };
  kernel.appendSessionEvent(event);
  const afterFirst = graph.snapshot();
  kernel.appendSessionEvent(event);
  const afterSecond = graph.snapshot();
  assert.deepEqual(jsonSnapshot(afterSecond), jsonSnapshot(afterFirst));
  kernel.close();
}

async function runContinuityBehaviorContract(): Promise<void> {
  const graph = new EventSourcedGraph({ runId: "run_behaviors", store: new InMemoryEventSourcedGraphStore(), clock: fixedClock("2026-05-20T00:00:00.000Z") });
  const runtime = new ReactiveGraphRuntime({
    graph,
    behaviors: createDefaultContinuityBehaviors({ staleEvidenceMaxAgeMs: 60_000 }),
    relationBehaviors: createDefaultContinuityRelationBehaviors()
  });

  const claim = graph.addObject("claim", { text: "EEG contact quality is degraded" }, { actor: "test" });
  await runtime.runUntilIdle();
  const unsupportedTask = graph.findObjects({ type: "task", where: { taskKind: "review_unsupported_claim", subjectObjectId: claim.id } })[0];
  assert.equal(unsupportedTask?.data.status, "open");

  const otherClaim = graph.addObject("claim", { text: "EEG contact quality is nominal", evidenceIds: ["manual"] }, { actor: "test" });
  graph.addRelation(claim.id, otherClaim.id, "contradicts", {}, { actor: "test" });
  await runtime.runUntilIdle();
  assert.ok(graph.findObjects({ type: "task", where: { taskKind: "review_contradiction" } }).length);

  const staleEvidence = graph.addObject("evidence", { sourceTimestamp: "2026-05-19T23:00:00.000Z", valueHash: "old" }, { actor: "test" });
  await runtime.runUntilIdle();
  assert.ok(graph.findObjects({ type: "task", where: { taskKind: "review_stale_evidence", subjectObjectId: staleEvidence.id } }).length);

  const hazardousAction = graph.addObject("action", { actionType: "actuator.command", hazardous: true }, { actor: "test" });
  await runtime.runUntilIdle();
  assert.equal(graph.findObjects({ type: "task", where: { taskKind: "approve_hazardous_action", subjectObjectId: hazardousAction.id } })[0]?.data.status, "waiting_approval");

  const failure = graph.addObject("failure", { code: "serial_disconnect", recoverable: true }, { actor: "test" });
  await runtime.runUntilIdle();
  assert.ok(graph.findObjects({ type: "task", where: { taskKind: "review_failure", subjectObjectId: failure.id } }).length);

  const dependency = graph.addObject("task", { stableKey: "task:dependency", status: "open" }, { actor: "test" });
  const dependent = graph.addObject("task", { stableKey: "task:dependent", status: "blocked" }, { actor: "test" });
  graph.addRelation(dependent.id, dependency.id, "depends_on", {}, { actor: "test" });
  graph.patchObject(dependency.id, { status: "completed" }, { actor: "test" });
  await runtime.runUntilIdle();
  assert.equal(graph.getObject(dependent.id)?.data.status, "open");

  const taskCountAfterFirstPass = graph.findObjects({ type: "task" }).length;
  graph.emit("object.created", { object: claim }, { actor: "test" });
  await runtime.runUntilIdle();
  assert.equal(graph.findObjects({ type: "task" }).length, taskCountAfterFirstPass);
  runtime.close();
}

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

function jsonSnapshot(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
