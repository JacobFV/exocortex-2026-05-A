import { EventSourcedGraph } from "./event-graph.js";
import { stableHash } from "./event-graph-ids.js";
import type { GraphFrame, GraphObject } from "./event-graph-types.js";

export interface EvaluationInput {
  subjectObjectId?: string;
  frameId?: string;
  evaluator: string;
  score: number;
  passed: boolean;
  criteria: Record<string, unknown>;
  result: Record<string, unknown>;
  now?: Date;
}

export interface FrameComparisonInput {
  frameIds: string[];
  evaluator: string;
  metrics: Record<string, Record<string, number>>;
  winnerFrameId?: string;
  now?: Date;
}

export interface SelfModificationProposalInput {
  targetObjectId: string;
  updates: Record<string, unknown>;
  proposedBy: string;
  reason: string;
  frameId?: string;
  now?: Date;
}

export interface EvaluationCandidate {
  candidateId: string;
  kind: "model" | "tool" | "runtime";
  label?: string;
  provider?: string;
  model?: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

export interface EvaluationCase {
  caseId: string;
  input: Record<string, unknown>;
  expected?: Record<string, unknown>;
  criteria?: Record<string, unknown>;
  weight?: number;
}

export interface EvaluationSuiteInput {
  suiteId: string;
  evaluator: string;
  description?: string;
  candidates: EvaluationCandidate[];
  cases: EvaluationCase[];
  criteria?: Record<string, unknown>;
  now?: Date;
}

export interface EvaluationCaseResult {
  score: number;
  passed: boolean;
  result: Record<string, unknown>;
  metrics?: Record<string, number>;
}

export interface EvaluationSuiteRunInput {
  suiteObjectId: string;
  candidateId: string;
  evaluator: string;
  caseResults: Record<string, EvaluationCaseResult>;
  metadata?: Record<string, unknown>;
  now?: Date;
}

export interface EvaluationSuiteComparisonInput {
  runObjectIds: string[];
  evaluator: string;
  winnerRunObjectId?: string;
  now?: Date;
}

export interface SelfModificationApprovalInput {
  selfModificationObjectId: string;
  requestedBy: string;
  reason: string;
  expiresAt?: string;
  now?: Date;
}

export interface ApproveSelfModificationInput {
  approvedBy: string;
  reason: string;
  now?: Date;
}

export interface SimulationFrameInput {
  baseFrameId?: string;
  goal: string;
  variants: Array<{
    variantId: string;
    label?: string;
    constraints?: Record<string, unknown>;
    budget?: Record<string, unknown>;
    behaviorNames?: string[];
    capabilitySet?: Record<string, unknown>;
    policy?: Record<string, unknown>;
  }>;
  createdBy: string;
  now?: Date;
}

export interface SimulationRunInput {
  simulationObjectId: string;
  frameId: string;
  runner: string;
  status: "passed" | "failed" | "errored";
  metrics?: Record<string, number>;
  result?: Record<string, unknown>;
  retryOfRunObjectId?: string;
  now?: Date;
}

export function recordEvaluation(graph: EventSourcedGraph, input: EvaluationInput): GraphObject {
  const stableKey = `evaluation:${input.evaluator}:${input.frameId ?? "no_frame"}:${input.subjectObjectId ?? "no_subject"}:${stableHash(input.criteria)}:${stableHash(input.result)}`;
  return graph.addObject(
    "evaluation",
    {
      stableKey,
      subjectObjectId: input.subjectObjectId,
      frameId: input.frameId,
      evaluator: input.evaluator,
      score: input.score,
      passed: input.passed,
      criteria: input.criteria,
      result: input.result
    },
    { actor: input.evaluator, frameId: input.frameId, createdAt: input.now }
  );
}

export function compareFrames(graph: EventSourcedGraph, input: FrameComparisonInput): GraphObject {
  const frames = input.frameIds.map((frameId) => requireFrame(graph, frameId));
  const winnerFrameId = input.winnerFrameId ?? chooseWinner(input.metrics);
  if (winnerFrameId && !input.frameIds.includes(winnerFrameId)) throw new Error(`winnerFrameId is not in frameIds: ${winnerFrameId}`);
  return graph.addObject(
    "frame_comparison",
    {
      stableKey: `frame_comparison:${stableHash({ frameIds: input.frameIds, metrics: input.metrics })}`,
      frameIds: input.frameIds,
      frameGoals: Object.fromEntries(frames.map((frame) => [frame.id, frame.goal])),
      evaluator: input.evaluator,
      metrics: input.metrics,
      winnerFrameId
    },
    { actor: input.evaluator, frameId: winnerFrameId, createdAt: input.now }
  );
}

export function proposeSelfModification(graph: EventSourcedGraph, input: SelfModificationProposalInput): GraphObject {
  const target = graph.getObject(input.targetObjectId);
  if (!target) throw new Error(`Unknown self-modification target: ${input.targetObjectId}`);
  const patch = graph.proposePatch(target.id, target.version, input.updates, {
    actor: input.proposedBy,
    frameId: input.frameId,
    createdAt: input.now,
    reason: input.reason
  });
  return graph.addObject(
    "self_modification",
    {
      stableKey: `self_modification:${patch.id}`,
      targetObjectId: target.id,
      patchId: patch.id,
      proposedBy: input.proposedBy,
      reason: input.reason,
      status: "proposed",
      updates: input.updates
    },
    { actor: input.proposedBy, frameId: input.frameId, createdAt: input.now }
  );
}

export function requestSelfModificationPromotionApproval(graph: EventSourcedGraph, input: SelfModificationApprovalInput): GraphObject {
  const proposal = graph.getObject(input.selfModificationObjectId);
  if (!proposal || proposal.type !== "self_modification") throw new Error(`Unknown self-modification proposal: ${input.selfModificationObjectId}`);
  const approval = graph.addObject(
    "approval",
    {
      stableKey: `approval:self_modification_promotion:${proposal.id}:${stableHash({ reason: input.reason })}`,
      approvalKind: "self_modification_promotion",
      subjectObjectId: proposal.id,
      status: "pending",
      requestedBy: input.requestedBy,
      reason: input.reason,
      expiresAt: input.expiresAt
    },
    { actor: input.requestedBy, createdAt: input.now }
  );
  graph.addRelation(proposal.id, approval.id, "requires_approval", {}, { actor: input.requestedBy, createdAt: input.now });
  return approval;
}

export function approveSelfModificationPromotion(graph: EventSourcedGraph, approvalObjectId: string, input: ApproveSelfModificationInput): GraphObject {
  const approval = requireApproval(graph, approvalObjectId, "self_modification_promotion");
  graph.patchObject(
    approval.id,
    {
      status: "approved",
      approvedBy: input.approvedBy,
      approvalReason: input.reason,
      approvedAt: (input.now ?? new Date()).toISOString()
    },
    { actor: input.approvedBy, createdAt: input.now }
  );
  return graph.getObject(approval.id)!;
}

export function promoteSelfModification(graph: EventSourcedGraph, selfModificationObjectId: string, input: { promotedBy: string; evaluationObjectId: string; approvalObjectId: string; now?: Date }): GraphObject {
  const proposal = graph.getObject(selfModificationObjectId);
  if (!proposal || proposal.type !== "self_modification") throw new Error(`Unknown self-modification proposal: ${selfModificationObjectId}`);
  const evaluation = graph.getObject(input.evaluationObjectId);
  if (!evaluation || evaluation.type !== "evaluation") throw new Error(`Unknown evaluation object: ${input.evaluationObjectId}`);
  if (evaluation.data.passed !== true) throw new Error(`Cannot promote self-modification without passing evaluation: ${input.evaluationObjectId}`);
  const approval = requireApproval(graph, input.approvalObjectId, "self_modification_promotion");
  if (approval.data.subjectObjectId !== proposal.id) throw new Error(`Approval ${approval.id} does not approve self-modification ${proposal.id}`);
  if (approval.data.status !== "approved") throw new Error(`Cannot promote self-modification without approved operator approval: ${approval.id}`);
  if (typeof approval.data.expiresAt === "string" && Date.parse(approval.data.expiresAt) < (input.now ?? new Date()).getTime()) {
    throw new Error(`Cannot promote self-modification with expired approval: ${approval.id}`);
  }
  const patchId = proposal.data.patchId;
  if (typeof patchId !== "string") throw new Error(`Self-modification proposal is missing patchId: ${selfModificationObjectId}`);
  graph.applyPatch(patchId, { actor: input.promotedBy, createdAt: input.now });
  graph.addRelation(proposal.id, evaluation.id, "validated_by", {}, { actor: input.promotedBy, createdAt: input.now });
  graph.addRelation(proposal.id, approval.id, "approved_by", {}, { actor: input.promotedBy, createdAt: input.now });
  graph.patchObject(proposal.id, { status: "promoted", promotedBy: input.promotedBy, evaluationObjectId: evaluation.id, approvalObjectId: approval.id }, { actor: input.promotedBy, createdAt: input.now });
  return graph.getObject(proposal.id)!;
}

export function recordEvaluationSuite(graph: EventSourcedGraph, input: EvaluationSuiteInput): GraphObject {
  requireUniqueIds(input.candidates.map((candidate) => candidate.candidateId), "candidateId");
  requireUniqueIds(input.cases.map((testCase) => testCase.caseId), "caseId");
  const stableKey = `evaluation_suite:${input.suiteId}:${stableHash({ cases: input.cases, criteria: input.criteria })}`;
  return graph.addObject(
    "evaluation_suite",
    {
      stableKey,
      suiteId: input.suiteId,
      description: input.description,
      evaluator: input.evaluator,
      candidates: input.candidates,
      cases: input.cases,
      criteria: input.criteria ?? {}
    },
    { actor: input.evaluator, createdAt: input.now }
  );
}

export function recordEvaluationSuiteRun(graph: EventSourcedGraph, input: EvaluationSuiteRunInput): GraphObject {
  const suite = requireEvaluationSuite(graph, input.suiteObjectId);
  const suiteId = requireStringData(suite, "suiteId");
  const candidates = requireArrayData<EvaluationCandidate>(suite, "candidates");
  const cases = requireArrayData<EvaluationCase>(suite, "cases");
  const candidate = candidates.find((item) => item.candidateId === input.candidateId);
  if (!candidate) throw new Error(`Unknown evaluation candidate for suite ${suite.id}: ${input.candidateId}`);
  const caseIds = new Set(cases.map((testCase) => testCase.caseId));
  for (const caseId of Object.keys(input.caseResults)) {
    if (!caseIds.has(caseId)) throw new Error(`Unknown evaluation case for suite ${suite.id}: ${caseId}`);
  }
  const aggregate = aggregateCaseResults(cases, input.caseResults);
  const run = graph.addObject(
    "evaluation_suite_run",
    {
      stableKey: `evaluation_suite_run:${suiteId}:${input.candidateId}:${input.evaluator}:${stableHash(input.caseResults)}`,
      suiteObjectId: suite.id,
      suiteId,
      candidateId: input.candidateId,
      candidate,
      evaluator: input.evaluator,
      caseResults: input.caseResults,
      score: aggregate.score,
      passed: aggregate.passed,
      completedCaseCount: aggregate.completedCaseCount,
      totalCaseCount: cases.length,
      metadata: input.metadata ?? {}
    },
    { actor: input.evaluator, createdAt: input.now }
  );
  graph.addRelation(run.id, suite.id, "evaluates", { candidateId: input.candidateId }, { actor: input.evaluator, createdAt: input.now });
  return run;
}

export function compareEvaluationSuiteRuns(graph: EventSourcedGraph, input: EvaluationSuiteComparisonInput): GraphObject {
  const runs = input.runObjectIds.map((runObjectId) => requireEvaluationSuiteRun(graph, runObjectId));
  if (!runs.length) throw new Error("Evaluation suite comparison requires at least one run");
  const suiteObjectIds = new Set(runs.map((run) => requireStringData(run, "suiteObjectId")));
  if (suiteObjectIds.size !== 1) throw new Error("Evaluation suite comparison runs must belong to the same suite");
  const winnerRunObjectId = input.winnerRunObjectId ?? chooseSuiteRunWinner(runs);
  if (!input.runObjectIds.includes(winnerRunObjectId)) throw new Error(`winnerRunObjectId is not in runObjectIds: ${winnerRunObjectId}`);
  const comparison = graph.addObject(
    "evaluation_suite_comparison",
    {
      stableKey: `evaluation_suite_comparison:${stableHash({ runObjectIds: input.runObjectIds, winnerRunObjectId })}`,
      suiteObjectId: [...suiteObjectIds][0],
      runObjectIds: input.runObjectIds,
      evaluator: input.evaluator,
      candidates: Object.fromEntries(runs.map((run) => [run.id, run.data.candidateId])),
      scores: Object.fromEntries(runs.map((run) => [run.id, run.data.score])),
      winnerRunObjectId,
      winnerCandidateId: graph.getObject(winnerRunObjectId)?.data.candidateId
    },
    { actor: input.evaluator, createdAt: input.now }
  );
  for (const run of runs) {
    graph.addRelation(comparison.id, run.id, "compares", {}, { actor: input.evaluator, createdAt: input.now });
  }
  return comparison;
}

export function createSimulationFrames(graph: EventSourcedGraph, input: SimulationFrameInput): GraphObject {
  if (!input.variants.length) throw new Error("Simulation frame creation requires at least one variant");
  requireUniqueIds(input.variants.map((variant) => variant.variantId), "variantId");
  const frameIds = input.variants.map((variant) => {
    const frame = graph.createFrame(variant.label ?? `${input.goal}: ${variant.variantId}`, {
      actor: input.createdBy,
      createdAt: input.now,
      constraints: {
        ...(variant.constraints ?? {}),
        ...(variant.capabilitySet ? { capabilitySet: variant.capabilitySet } : {}),
        ...(variant.policy ? { policy: variant.policy } : {})
      },
      budget: variant.budget,
      behaviorNames: variant.behaviorNames
    });
    return frame.id;
  });
  const simulation = graph.addObject(
    "simulation",
    {
      stableKey: `simulation:${stableHash({ baseFrameId: input.baseFrameId, goal: input.goal, variants: input.variants })}`,
      baseFrameId: input.baseFrameId,
      goal: input.goal,
      variants: input.variants,
      frameIds,
      status: "ready"
    },
    { actor: input.createdBy, frameId: input.baseFrameId, createdAt: input.now }
  );
  return simulation;
}

export function recordSimulationRun(graph: EventSourcedGraph, input: SimulationRunInput): GraphObject {
  const simulation = graph.getObject(input.simulationObjectId);
  if (!simulation || simulation.type !== "simulation") throw new Error(`Unknown simulation: ${input.simulationObjectId}`);
  const frameIds = requireArrayData<string>(simulation, "frameIds");
  if (!frameIds.includes(input.frameId)) throw new Error(`Frame ${input.frameId} is not part of simulation ${simulation.id}`);
  const run = graph.addObject(
    "simulation_run",
    {
      stableKey: `simulation_run:${simulation.id}:${input.frameId}:${input.runner}:${stableHash({ status: input.status, metrics: input.metrics, result: input.result, retryOfRunObjectId: input.retryOfRunObjectId })}`,
      simulationObjectId: simulation.id,
      frameId: input.frameId,
      runner: input.runner,
      status: input.status,
      metrics: input.metrics ?? {},
      result: input.result ?? {},
      retryOfRunObjectId: input.retryOfRunObjectId
    },
    { actor: input.runner, frameId: input.frameId, createdAt: input.now }
  );
  graph.addRelation(run.id, simulation.id, "runs_simulation", { status: input.status }, { actor: input.runner, frameId: input.frameId, createdAt: input.now });
  if (input.retryOfRunObjectId) graph.addRelation(run.id, input.retryOfRunObjectId, "retries", {}, { actor: input.runner, frameId: input.frameId, createdAt: input.now });
  return run;
}

function requireFrame(graph: EventSourcedGraph, frameId: string): GraphFrame {
  const frame = graph.snapshot().frames.find((candidate) => candidate.id === frameId);
  if (!frame) throw new Error(`Unknown frame: ${frameId}`);
  return frame;
}

function chooseWinner(metrics: Record<string, Record<string, number>>): string | undefined {
  let winner: { frameId: string; score: number } | undefined;
  for (const [frameId, values] of Object.entries(metrics)) {
    const score = Object.values(values).reduce((sum, value) => sum + value, 0);
    if (!winner || score > winner.score) winner = { frameId, score };
  }
  return winner?.frameId;
}

function requireEvaluationSuite(graph: EventSourcedGraph, objectId: string): GraphObject {
  const suite = graph.getObject(objectId);
  if (!suite || suite.type !== "evaluation_suite") throw new Error(`Unknown evaluation suite: ${objectId}`);
  return suite;
}

function requireEvaluationSuiteRun(graph: EventSourcedGraph, objectId: string): GraphObject {
  const run = graph.getObject(objectId);
  if (!run || run.type !== "evaluation_suite_run") throw new Error(`Unknown evaluation suite run: ${objectId}`);
  return run;
}

function requireApproval(graph: EventSourcedGraph, objectId: string, approvalKind: string): GraphObject {
  const approval = graph.getObject(objectId);
  if (!approval || approval.type !== "approval" || approval.data.approvalKind !== approvalKind) throw new Error(`Unknown ${approvalKind} approval: ${objectId}`);
  return approval;
}

function requireArrayData<T>(object: GraphObject, key: string): T[] {
  const value = object.data[key];
  if (!Array.isArray(value)) throw new Error(`Graph object ${object.id} requires array data ${key}`);
  return value as T[];
}

function requireStringData(object: GraphObject, key: string): string {
  const value = object.data[key];
  if (typeof value !== "string") throw new Error(`Graph object ${object.id} requires string data ${key}`);
  return value;
}

function requireUniqueIds(ids: string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) throw new Error(`${label} is required`);
    if (seen.has(id)) throw new Error(`Duplicate ${label}: ${id}`);
    seen.add(id);
  }
}

function aggregateCaseResults(cases: EvaluationCase[], caseResults: Record<string, EvaluationCaseResult>): { score: number; passed: boolean; completedCaseCount: number } {
  let weightedScore = 0;
  let weightTotal = 0;
  let completedCaseCount = 0;
  let passed = true;
  for (const testCase of cases) {
    const result = caseResults[testCase.caseId];
    const weight = testCase.weight ?? 1;
    weightTotal += weight;
    if (!result) {
      passed = false;
      continue;
    }
    completedCaseCount += 1;
    weightedScore += result.score * weight;
    if (!result.passed) passed = false;
  }
  return { score: weightTotal > 0 ? weightedScore / weightTotal : 0, passed, completedCaseCount };
}

function chooseSuiteRunWinner(runs: GraphObject[]): string {
  let winner: { runObjectId: string; score: number; passed: boolean } | undefined;
  for (const run of runs) {
    const score = typeof run.data.score === "number" ? run.data.score : 0;
    const passed = run.data.passed === true;
    if (!winner || (passed && !winner.passed) || (passed === winner.passed && score > winner.score)) winner = { runObjectId: run.id, score, passed };
  }
  return winner?.runObjectId ?? runs[0]!.id;
}
