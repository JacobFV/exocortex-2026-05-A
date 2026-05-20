import { stableHash } from "./event-graph-ids.js";
import type { ContinuityEvent, GraphObject, GraphRelation } from "./event-graph-types.js";
import type { BehaviorContext, GraphBehavior, RelationBehavior } from "./reactive-runtime.js";

export interface ContinuityBehaviorOptions {
  staleEvidenceMaxAgeMs?: number;
}

export function createDefaultContinuityBehaviors(options: ContinuityBehaviorOptions = {}): GraphBehavior[] {
  return [
    unsupportedClaimReviewBehavior(),
    contradictionReviewBehavior(),
    staleEvidenceReviewBehavior(options),
    hazardousActionApprovalBehavior(),
    failureReviewBehavior(),
    selfModificationEvaluationBehavior(),
    failedEvaluationReviewBehavior(),
    safetyDenialAuditBehavior(),
    uncalibratedSensorEvidenceBehavior(),
    artifactBlobPersistenceBehavior()
  ];
}

export function createDefaultContinuityRelationBehaviors(): RelationBehavior[] {
  return [dependencyUnblockingBehavior()];
}

export function unsupportedClaimReviewBehavior(): GraphBehavior {
  return {
    name: "unsupported-claim-review",
    on: ["object.created"],
    run(context) {
      const claim = objectFromEvent(context.event);
      if (!claim || claim.type !== "claim") return;
      const markedSupported = claim.data.supported === true || Array.isArray(claim.data.evidenceIds) && claim.data.evidenceIds.length > 0;
      const supportEdges = context.graph.findRelations({ sourceId: claim.id, type: "supports" });
      if (markedSupported || supportEdges.length) return;
      const task = ensureTask(context, {
        stableKey: `task:review_unsupported_claim:${claim.id}`,
        title: `Review unsupported claim`,
        taskKind: "review_unsupported_claim",
        severity: "medium",
        subjectObjectId: claim.id,
        reason: "Claim has no supporting evidence relation or evidence id."
      });
      ensureRelation(context, task.id, claim.id, "depends_on", { reason: "review subject" });
    }
  };
}

export function contradictionReviewBehavior(): GraphBehavior {
  return {
    name: "contradiction-review",
    on: ["relation.created"],
    run(context) {
      const relation = relationFromEvent(context.event);
      if (!relation || relation.type !== "contradicts") return;
      const task = ensureTask(context, {
        stableKey: `task:review_contradiction:${stableHash([relation.sourceId, relation.targetId])}`,
        title: "Review contradiction",
        taskKind: "review_contradiction",
        severity: "high",
        subjectObjectId: relation.sourceId,
        relatedObjectId: relation.targetId,
        reason: "Two graph objects contradict each other."
      });
      ensureRelation(context, task.id, relation.sourceId, "depends_on", { reason: "contradiction source" });
      ensureRelation(context, task.id, relation.targetId, "depends_on", { reason: "contradiction target" });
    }
  };
}

export function staleEvidenceReviewBehavior(options: ContinuityBehaviorOptions = {}): GraphBehavior {
  const maxAgeMs = options.staleEvidenceMaxAgeMs ?? 24 * 60 * 60 * 1000;
  return {
    name: "stale-evidence-review",
    on: ["object.created", "patch.applied"],
    run(context) {
      const evidence = eventObject(context);
      if (!evidence || evidence.type !== "evidence" || !isEvidenceStale(evidence, context.event, maxAgeMs)) return;
      const task = ensureTask(context, {
        stableKey: `task:review_stale_evidence:${evidence.id}`,
        title: "Review stale evidence",
        taskKind: "review_stale_evidence",
        severity: "medium",
        subjectObjectId: evidence.id,
        reason: "Evidence is marked stale or older than the configured evidence age window."
      });
      ensureRelation(context, task.id, evidence.id, "depends_on", { reason: "stale evidence subject" });
    }
  };
}

export function hazardousActionApprovalBehavior(): GraphBehavior {
  return {
    name: "hazardous-action-approval",
    on: ["object.created"],
    run(context) {
      const action = objectFromEvent(context.event);
      if (!action || action.type !== "action" || action.data.hazardous !== true) return;
      const task = ensureTask(context, {
        stableKey: `task:approve_hazardous_action:${action.id}`,
        title: "Approve hazardous action",
        taskKind: "approve_hazardous_action",
        severity: "hazardous",
        status: "waiting_approval",
        subjectObjectId: action.id,
        reason: "Hazardous actuator-like action requires explicit approval before output."
      });
      ensureRelation(context, task.id, action.id, "depends_on", { reason: "hazardous action subject" });
    }
  };
}

export function failureReviewBehavior(): GraphBehavior {
  return {
    name: "failure-review",
    on: ["object.created"],
    run(context) {
      const failure = objectFromEvent(context.event);
      if (!failure || failure.type !== "failure") return;
      const task = ensureTask(context, {
        stableKey: `task:review_failure:${failure.id}`,
        title: "Review failure",
        taskKind: "review_failure",
        severity: failure.data.recoverable === false ? "high" : "medium",
        subjectObjectId: failure.id,
        reason: "A runtime, tool, session, or behavior failure was recorded."
      });
      ensureRelation(context, task.id, failure.id, "depends_on", { reason: "failure subject" });
    }
  };
}

export function selfModificationEvaluationBehavior(): GraphBehavior {
  return {
    name: "self-modification-evaluation-required",
    on: ["object.created"],
    run(context) {
      const proposal = objectFromEvent(context.event);
      if (!proposal || proposal.type !== "self_modification" || proposal.data.status !== "proposed") return;
      const task = ensureTask(context, {
        stableKey: `task:evaluate_self_modification:${proposal.id}`,
        title: "Evaluate self-modification proposal",
        taskKind: "evaluate_self_modification",
        severity: "high",
        status: "blocked",
        subjectObjectId: proposal.id,
        reason: "Self-modification proposals must pass an evaluation before promotion."
      });
      ensureRelation(context, task.id, proposal.id, "depends_on", { reason: "self-modification proposal" });
    }
  };
}

export function failedEvaluationReviewBehavior(): GraphBehavior {
  return {
    name: "failed-evaluation-review",
    on: ["object.created"],
    run(context) {
      const evaluation = objectFromEvent(context.event);
      if (!evaluation || evaluation.type !== "evaluation" || evaluation.data.passed !== false) return;
      const task = ensureTask(context, {
        stableKey: `task:review_failed_evaluation:${evaluation.id}`,
        title: "Review failed evaluation",
        taskKind: "review_failed_evaluation",
        severity: "medium",
        subjectObjectId: evaluation.id,
        reason: "An evaluation failed and needs operator or agent review."
      });
      ensureRelation(context, task.id, evaluation.id, "depends_on", { reason: "failed evaluation" });
    }
  };
}

export function safetyDenialAuditBehavior(): GraphBehavior {
  return {
    name: "safety-denial-audit",
    on: ["object.created"],
    run(context) {
      const denial = objectFromEvent(context.event);
      if (!denial || denial.type !== "safety_denial") return;
      const task = ensureTask(context, {
        stableKey: `task:audit_safety_denial:${denial.id}`,
        title: "Audit safety denial",
        taskKind: "audit_safety_denial",
        severity: "hazardous",
        subjectObjectId: denial.id,
        reason: "A hazardous or actuator-related command was denied by safety policy."
      });
      ensureRelation(context, task.id, denial.id, "depends_on", { reason: "safety denial" });
    }
  };
}

export function uncalibratedSensorEvidenceBehavior(): GraphBehavior {
  return {
    name: "uncalibrated-sensor-evidence",
    on: ["object.created"],
    run(context) {
      const evidence = objectFromEvent(context.event);
      if (!evidence || evidence.type !== "evidence") return;
      const observationType = String(evidence.data.observationType ?? "");
      if (!observationType.startsWith("sensor.") && !observationType.includes("analog") && !observationType.includes("eeg")) return;
      const value = evidence.data.value;
      if (value && typeof value === "object" && Array.isArray((value as { calibrationIds?: unknown }).calibrationIds)) return;
      const task = ensureTask(context, {
        stableKey: `task:calibrate_sensor_evidence:${evidence.id}`,
        title: "Calibrate sensor evidence",
        taskKind: "calibrate_sensor_evidence",
        severity: "medium",
        subjectObjectId: evidence.id,
        reason: "Sensor evidence has no calibration identifiers in the observed value."
      });
      ensureRelation(context, task.id, evidence.id, "depends_on", { reason: "uncalibrated sensor evidence" });
    }
  };
}

export function artifactBlobPersistenceBehavior(): GraphBehavior {
  return {
    name: "artifact-blob-persistence",
    on: ["object.created"],
    run(context) {
      const artifactObject = objectFromEvent(context.event);
      if (!artifactObject || artifactObject.type !== "artifact") return;
      const artifact = artifactObject.data.artifact;
      if (!artifact || typeof artifact !== "object") return;
      const kind = String((artifact as { kind?: unknown }).kind ?? "");
      const needsBlob = ["image", "audio", "video", "screenshot", "browser_recording", "sensor_log"].includes(kind);
      const uri = (artifact as { uri?: unknown }).uri ?? (artifact as { value?: { uri?: unknown } }).value?.uri;
      if (!needsBlob || typeof uri === "string") return;
      const task = ensureTask(context, {
        stableKey: `task:persist_artifact_blob:${artifactObject.id}`,
        title: "Persist artifact blob",
        taskKind: "persist_artifact_blob",
        severity: "medium",
        subjectObjectId: artifactObject.id,
        reason: "Media or sensor-log artifact has no durable blob URI."
      });
      ensureRelation(context, task.id, artifactObject.id, "depends_on", { reason: "artifact missing blob" });
    }
  };
}

export function dependencyUnblockingBehavior(): RelationBehavior {
  return {
    name: "dependency-unblocking",
    relationType: "depends_on",
    on: ["patch.applied", "object.created"],
    run(relation, context) {
      const changed = eventObject(context);
      if (!changed || !isTerminal(changed)) return;
      for (const task of candidateDependentTasks(relation, changed.id, context)) {
        const deps = context.graph.findRelations({ sourceId: task.id, type: "depends_on" });
        const dependencyIds = deps.length ? deps.map((edge) => edge.targetId) : [changed.id];
        const allTerminal = dependencyIds.every((id) => {
          const object = context.graph.getObject(id);
          return object ? isTerminal(object) : false;
        });
        if (!allTerminal || !isBlocked(task)) continue;
        context.graph.patchObject(task.id, { status: "open", unblockedByObjectId: changed.id }, { actor: "dependency-unblocking", causedBy: context.event.id, reason: "All dependencies are terminal." });
      }
    }
  };
}

interface TaskInput {
  stableKey: string;
  title: string;
  taskKind: string;
  severity: string;
  subjectObjectId: string;
  relatedObjectId?: string;
  reason: string;
  status?: string;
}

function ensureTask(context: BehaviorContext, input: TaskInput): GraphObject {
  const existing = context.graph.findObjects({ type: "task", where: { stableKey: input.stableKey } })[0];
  if (existing) return existing;
  return context.graph.addObject(
    "task",
    {
      stableKey: input.stableKey,
      title: input.title,
      taskKind: input.taskKind,
      status: input.status ?? "open",
      severity: input.severity,
      subjectObjectId: input.subjectObjectId,
      relatedObjectId: input.relatedObjectId,
      reason: input.reason,
      sourceBehavior: context.event.type,
      triggeringEventId: context.event.id
    },
    { actor: "continuity-behavior", causedBy: context.event.id, frameId: context.event.frameId }
  );
}

function ensureRelation(context: BehaviorContext, sourceId: string, targetId: string, type: string, data: Record<string, unknown>): GraphRelation {
  return context.graph.findRelations({ sourceId, targetId, type })[0] ?? context.graph.addRelation(sourceId, targetId, type, data, { actor: "continuity-behavior", causedBy: context.event.id, frameId: context.event.frameId });
}

function eventObject(context: BehaviorContext): GraphObject | undefined {
  const object = objectFromEvent(context.event);
  if (object) return object;
  if (typeof context.event.payload.objectId === "string") return context.graph.getObject(context.event.payload.objectId);
  return undefined;
}

function objectFromEvent(event: ContinuityEvent): GraphObject | undefined {
  const value = event.payload.object;
  return isGraphObject(value) ? value : undefined;
}

function relationFromEvent(event: ContinuityEvent): GraphRelation | undefined {
  const value = event.payload.relation;
  return isGraphRelation(value) ? value : undefined;
}

function candidateDependentTasks(relation: GraphRelation, changedObjectId: string, context: BehaviorContext): GraphObject[] {
  const candidates = new Set<string>();
  if (relation.targetId === changedObjectId) candidates.add(relation.sourceId);
  if (relation.sourceId === changedObjectId) candidates.add(relation.targetId);
  return [...candidates].map((id) => context.graph.getObject(id)).filter((object): object is GraphObject => object?.type === "task");
}

function isEvidenceStale(evidence: GraphObject, event: ContinuityEvent, maxAgeMs: number): boolean {
  if (evidence.data.stale === true || evidence.data.status === "stale") return true;
  const sourceTimestamp = typeof evidence.data.sourceTimestamp === "string" ? Date.parse(evidence.data.sourceTimestamp) : Number.NaN;
  const eventTimestamp = Date.parse(event.createdAt);
  return Number.isFinite(sourceTimestamp) && Number.isFinite(eventTimestamp) && eventTimestamp - sourceTimestamp > maxAgeMs;
}

function isTerminal(object: GraphObject): boolean {
  return object.data.completed === true || ["accepted", "closed", "completed", "done", "resolved", "success", "succeeded"].includes(String(object.data.status ?? ""));
}

function isBlocked(object: GraphObject): boolean {
  return ["blocked", "waiting_dependency"].includes(String(object.data.status ?? ""));
}

function isGraphObject(value: unknown): value is GraphObject {
  return !!value && typeof value === "object" && typeof (value as GraphObject).id === "string" && typeof (value as GraphObject).type === "string" && !!(value as GraphObject).data;
}

function isGraphRelation(value: unknown): value is GraphRelation {
  return !!value && typeof value === "object" && typeof (value as GraphRelation).id === "string" && typeof (value as GraphRelation).sourceId === "string" && typeof (value as GraphRelation).targetId === "string";
}
