import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent } from "@exocortex/protocol";
import { assembleGraphContext, renderGraphContextForPrompt } from "./context-assembly.js";
import { compareEvaluationSuiteRuns, compareFrames, promoteSelfModification, proposeSelfModification, recordEvaluation, recordEvaluationSuite, recordEvaluationSuiteRun } from "./evaluation.js";
import { createDefaultContinuityBehaviors, createDefaultContinuityRelationBehaviors } from "./event-graph-behaviors.js";
import { EventSourcedGraph } from "./event-graph.js";
import { EventGraphKernel } from "./event-graph-kernel.js";
import { InMemoryEventSourcedGraphStore, SQLiteEventSourcedGraphStore } from "./event-graph-store.js";
import { exportContinuityRun, exportContinuityRunFromStore, readContinuityRunExport, validateContinuityRunExport, writeContinuityRunExport } from "./export.js";
import { listSafetyDenials, recordSafetyDenial } from "./operational-state.js";
import { ReactiveGraphRuntime } from "./reactive-runtime.js";

runStorelessGraphContract();
runKernelIdempotencyContract();
runContextEvaluationPromotionContract();
await runContinuityBehaviorContract();
runSafetyDenialContract();
await runStoreContract(new InMemoryEventSourcedGraphStore());

const tempRoot = mkdtempSync(join(tmpdir(), "exocortex-event-graph-"));
try {
  const sqlite = new SQLiteEventSourcedGraphStore(join(tempRoot, "graph.db"));
  assert.deepEqual(sqlite.listMigrations().map((migration) => migration.version), [1, 2]);
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

  const exported = exportContinuityRun(graph, new Date("2026-05-20T00:00:01.000Z"));
  validateContinuityRunExport(exported);
  assert.equal(exported.summary.objectCount, graph.snapshot().objects.length);
  const exportedFromStore = exportContinuityRunFromStore(store, graph.runId, new Date("2026-05-20T00:00:01.000Z"));
  assert.deepEqual(jsonSnapshot(exportedFromStore.snapshot), jsonSnapshot(graph.snapshot()));
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

  const selfModification = graph.addObject("self_modification", { status: "proposed", targetObjectId: "policy_1" }, { actor: "test" });
  await runtime.runUntilIdle();
  assert.ok(graph.findObjects({ type: "task", where: { taskKind: "evaluate_self_modification", subjectObjectId: selfModification.id } }).length);

  const failedEvaluation = graph.addObject("evaluation", { passed: false, score: 0.1 }, { actor: "test" });
  await runtime.runUntilIdle();
  assert.ok(graph.findObjects({ type: "task", where: { taskKind: "review_failed_evaluation", subjectObjectId: failedEvaluation.id } }).length);

  const safetyDenial = graph.addObject("safety_denial", { channel: "laser_enable", reason: "not armed" }, { actor: "test" });
  await runtime.runUntilIdle();
  assert.ok(graph.findObjects({ type: "task", where: { taskKind: "audit_safety_denial", subjectObjectId: safetyDenial.id } }).length);

  const uncalibratedEvidence = graph.addObject("evidence", { observationType: "sensor.analog_sample", value: { raw: 10 } }, { actor: "test" });
  await runtime.runUntilIdle();
  assert.ok(graph.findObjects({ type: "task", where: { taskKind: "calibrate_sensor_evidence", subjectObjectId: uncalibratedEvidence.id } }).length);

  const mediaArtifact = graph.addObject("artifact", { artifact: { kind: "image", title: "frame", value: { bytes: "inline" } } }, { actor: "test" });
  await runtime.runUntilIdle();
  assert.ok(graph.findObjects({ type: "task", where: { taskKind: "persist_artifact_blob", subjectObjectId: mediaArtifact.id } }).length);

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

function runSafetyDenialContract(): void {
  const graph = new EventSourcedGraph({ runId: "run_safety_denials", store: new InMemoryEventSourcedGraphStore(), clock: fixedClock("2026-05-20T00:00:00.000Z") });
  recordSafetyDenial(graph, {
    channel: "laser_enable",
    code: "actuator_safety_rejected",
    reason: "actuator is not armed",
    command: { enabled: true, duty: 1 },
    now: new Date("2026-05-20T00:00:00.000Z")
  });
  const denials = listSafetyDenials(graph, "laser_enable");
  assert.equal(denials.length, 1);
  assert.equal(denials[0]?.data.code, "actuator_safety_rejected");
  assert.equal(typeof denials[0]?.data.commandHash, "string");
}

function runContextEvaluationPromotionContract(): void {
  const graph = new EventSourcedGraph({ runId: "run_context_eval", store: new InMemoryEventSourcedGraphStore(), clock: fixedClock("2026-05-20T00:00:00.000Z") });
  const session = graph.addObject("agent_session", { stableKey: "agent_session:sess_ctx", sessionId: "sess_ctx" }, { actor: "test" });
  const goal = graph.addObject("goal", { stableKey: "goal:sess_ctx:primary", sessionId: "sess_ctx", text: "Improve context assembly" }, { actor: "test" });
  const modality = graph.addObject("modality", { stableKey: "modality:app_input_text", key: "app_input_text" }, { actor: "test" });
  graph.addRelation(session.id, goal.id, "has_goal", {}, { actor: "test" });
  graph.addRelation(session.id, modality.id, "uses", {}, { actor: "test" });
  graph.addObject("task", { stableKey: "task:ctx", taskKind: "review_context", status: "open" }, { actor: "test" });
  const context = assembleGraphContext(graph, { sessionId: "sess_ctx", modalityKey: "app_input_text", recentEvents: 3 });
  assert.equal(context.sessions.length, 1);
  assert.equal(context.goals[0]?.data.text, "Improve context assembly");
  assert.equal(context.modalities[0]?.data.key, "app_input_text");
  assert.ok(context.openTasks.length);

  for (let i = 0; i < 5; i += 1) {
    graph.addObject("message", { stableKey: `message:ctx:${i}`, text: `context detail ${i} ${"x".repeat(80)}` }, { actor: "test" });
  }
  graph.addObject("task", { stableKey: "task:ctx:followup", taskKind: "review_context_followup", status: "open" }, { actor: "test" });
  graph.addObject("task", { stableKey: "task:ctx:blocked", taskKind: "review_context_blocked", status: "blocked" }, { actor: "test" });
  const compactContext = assembleGraphContext(graph, {
    sessionId: "unscoped",
    modalityKey: "unscoped",
    includeObjectTypes: ["message", "task"],
    runtimePolicy: { provider: "local", model: "tiny-runtime", detail: "compact", targetInputTokens: 512 },
    retention: { maxOpenTasks: 2, maxRecentObjects: 3, maxRecentEvents: 4, maxObjectDataStringLength: 24, maxEventPayloadStringLength: 24 }
  });
  assert.equal(compactContext.openTasks.length, 2);
  assert.equal(compactContext.recentObjects.length, 3);
  assert.equal(compactContext.recentEvents.length, 4);
  assert.ok(compactContext.compaction.compactedStrings > 0);
  assert.ok(compactContext.compaction.omittedCounts.recentObjects > 0);
  const promptPayload = JSON.parse(renderGraphContextForPrompt(compactContext)) as { recentEvents: unknown[]; recentObjects: Array<{ data: { text?: string } }> };
  assert.ok(promptPayload.recentEvents.length <= 4);
  assert.ok(promptPayload.recentObjects.some((object) => object.data.text?.includes("[truncated")));

  const suite = recordEvaluationSuite(graph, {
    suiteId: "runtime-intelligence",
    evaluator: "test",
    candidates: [
      { candidateId: "model_fast", kind: "model", provider: "local", model: "fast" },
      { candidateId: "model_deep", kind: "model", provider: "local", model: "deep" },
      { candidateId: "tool_search", kind: "tool", toolName: "search" }
    ],
    cases: [
      { caseId: "case_summary", input: { prompt: "summarize" }, expected: { format: "bullets" }, weight: 1 },
      { caseId: "case_tool", input: { prompt: "find source" }, expected: { tool: "search" }, weight: 3 }
    ],
    criteria: { minScore: 0.8 }
  });
  const fastRun = recordEvaluationSuiteRun(graph, {
    suiteObjectId: suite.id,
    candidateId: "model_fast",
    evaluator: "test",
    caseResults: {
      case_summary: { score: 0.8, passed: true, result: { latencyMs: 20 } },
      case_tool: { score: 0.6, passed: true, result: { latencyMs: 30 } }
    }
  });
  const deepRun = recordEvaluationSuiteRun(graph, {
    suiteObjectId: suite.id,
    candidateId: "model_deep",
    evaluator: "test",
    caseResults: {
      case_summary: { score: 0.8, passed: true, result: { latencyMs: 50 } },
      case_tool: { score: 1, passed: true, result: { latencyMs: 60 } }
    }
  });
  const toolRun = recordEvaluationSuiteRun(graph, {
    suiteObjectId: suite.id,
    candidateId: "tool_search",
    evaluator: "test",
    caseResults: {
      case_summary: { score: 0.5, passed: false, result: { reason: "not a model" } },
      case_tool: { score: 1, passed: true, result: { calls: 1 } }
    }
  });
  assert.ok(Math.abs(Number(deepRun.data.score) - 0.95) < 0.000_001);
  assert.equal(toolRun.data.passed, false);
  const suiteComparison = compareEvaluationSuiteRuns(graph, { runObjectIds: [fastRun.id, deepRun.id, toolRun.id], evaluator: "test" });
  assert.equal(suiteComparison.data.winnerRunObjectId, deepRun.id);
  assert.equal(suiteComparison.data.winnerCandidateId, "model_deep");

  const frameA = graph.createFrame("Policy A", { id: "frame_a", actor: "test" });
  const frameB = graph.createFrame("Policy B", { id: "frame_b", actor: "test" });
  const comparison = compareFrames(graph, {
    frameIds: [frameA.id, frameB.id],
    evaluator: "test",
    metrics: { [frameA.id]: { score: 0.4 }, [frameB.id]: { score: 0.9 } }
  });
  assert.equal(comparison.data.winnerFrameId, frameB.id);

  const policy = graph.addObject("policy", { stableKey: "policy:prompt", prompt: "old" }, { actor: "test" });
  const proposal = proposeSelfModification(graph, {
    targetObjectId: policy.id,
    updates: { prompt: "new" },
    proposedBy: "test",
    reason: "evaluation improved",
    frameId: frameB.id
  });
  const evaluation = recordEvaluation(graph, {
    subjectObjectId: proposal.id,
    frameId: frameB.id,
    evaluator: "test",
    score: 0.95,
    passed: true,
    criteria: { minScore: 0.9 },
    result: { score: 0.95 }
  });
  const promoted = promoteSelfModification(graph, proposal.id, { promotedBy: "test", evaluationObjectId: evaluation.id });
  assert.equal(promoted.data.status, "promoted");
  assert.equal(graph.getObject(policy.id)?.data.prompt, "new");
}

{
  const tempRoot = mkdtempSync(join(tmpdir(), "exocortex-event-graph-export-"));
  try {
    const exportPath = join(tempRoot, "run.json");
    const graph = new EventSourcedGraph({ runId: "run_export_file", store: new InMemoryEventSourcedGraphStore(), clock: fixedClock("2026-05-20T00:00:00.000Z") });
    graph.addObject("task", { stableKey: "task:export", status: "open" }, { actor: "test" });
    writeContinuityRunExport(exportPath, exportContinuityRun(graph, new Date("2026-05-20T00:00:01.000Z")));
    assert.equal(readContinuityRunExport(exportPath).summary.objectCount, 1);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

function jsonSnapshot(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
