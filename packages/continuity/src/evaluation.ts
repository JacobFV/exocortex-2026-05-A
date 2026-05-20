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

export function promoteSelfModification(graph: EventSourcedGraph, selfModificationObjectId: string, input: { promotedBy: string; evaluationObjectId: string; now?: Date }): GraphObject {
  const proposal = graph.getObject(selfModificationObjectId);
  if (!proposal || proposal.type !== "self_modification") throw new Error(`Unknown self-modification proposal: ${selfModificationObjectId}`);
  const evaluation = graph.getObject(input.evaluationObjectId);
  if (!evaluation || evaluation.type !== "evaluation") throw new Error(`Unknown evaluation object: ${input.evaluationObjectId}`);
  if (evaluation.data.passed !== true) throw new Error(`Cannot promote self-modification without passing evaluation: ${input.evaluationObjectId}`);
  const patchId = proposal.data.patchId;
  if (typeof patchId !== "string") throw new Error(`Self-modification proposal is missing patchId: ${selfModificationObjectId}`);
  graph.applyPatch(patchId, { actor: input.promotedBy, createdAt: input.now });
  graph.addRelation(proposal.id, evaluation.id, "validated_by", {}, { actor: input.promotedBy, createdAt: input.now });
  graph.patchObject(proposal.id, { status: "promoted", promotedBy: input.promotedBy, evaluationObjectId: evaluation.id }, { actor: input.promotedBy, createdAt: input.now });
  return graph.getObject(proposal.id)!;
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
