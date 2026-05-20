import { EventSourcedGraph } from "./event-graph.js";
import { stableHash } from "./event-graph-ids.js";
import type { GraphObject } from "./event-graph-types.js";

export interface ContinuityCalibrationProfileInput {
  profileId: string;
  deviceKey: string;
  profile: unknown;
  active?: boolean;
  supersedesProfileId?: string;
  now?: Date;
}

export interface ContinuitySafetyGrantInput {
  grantId: string;
  channel: string;
  approvedBy: string;
  reason: string;
  expiresAt?: string;
  hazardous?: boolean;
  now?: Date;
}

export interface ContinuitySafetyPolicyInput {
  channel: string;
  policy: Record<string, unknown>;
  active?: boolean;
  now?: Date;
}

export interface ContinuitySafetyDenialInput {
  channel: string;
  code: string;
  reason: string;
  command?: unknown;
  now?: Date;
}

export function acceptCalibrationProfile(graph: EventSourcedGraph, input: ContinuityCalibrationProfileInput): GraphObject {
  const stableKey = `calibration_profile:${input.deviceKey}:${input.profileId}`;
  const profile = upsertGraphObject(
    graph,
    stableKey,
    "calibration_profile",
    {
      stableKey,
      profileId: input.profileId,
      deviceKey: input.deviceKey,
      active: input.active ?? true,
      profileHash: stableHash(input.profile),
      profile: input.profile
    },
    "continuity-operational-state",
    input.now
  );

  if (input.supersedesProfileId) {
    const superseded = graph.findObjects({ type: "calibration_profile", where: { stableKey: `calibration_profile:${input.deviceKey}:${input.supersedesProfileId}` } })[0];
    if (superseded) {
      graph.patchObject(superseded.id, { active: false, supersededByProfileId: input.profileId }, { actor: "continuity-operational-state", createdAt: input.now, reason: "Supersede calibration profile" });
      ensureRelation(graph, profile.id, superseded.id, "supersedes", { deviceKey: input.deviceKey }, "continuity-operational-state", input.now);
    }
  }

  return graph.getObject(profile.id)!;
}

export function acceptSafetyGrant(graph: EventSourcedGraph, input: ContinuitySafetyGrantInput): GraphObject {
  const stableKey = `safety_grant:${input.channel}:${input.grantId}`;
  const grant = upsertGraphObject(
    graph,
    stableKey,
    "safety_grant",
    {
      stableKey,
      grantId: input.grantId,
      channel: input.channel,
      approvedBy: input.approvedBy,
      reason: input.reason,
      expiresAt: input.expiresAt,
      hazardous: input.hazardous ?? false
    },
    "continuity-operational-state",
    input.now
  );
  const approvalStableKey = `approval:safety_grant:${input.channel}:${input.grantId}`;
  const approval = upsertGraphObject(
    graph,
    approvalStableKey,
    "approval",
    {
      stableKey: approvalStableKey,
      approvalKind: "safety_grant",
      subjectStableKey: stableKey,
      approvedBy: input.approvedBy,
      reason: input.reason,
      expiresAt: input.expiresAt,
      hazardous: input.hazardous ?? false
    },
    "continuity-operational-state",
    input.now
  );
  ensureRelation(graph, grant.id, approval.id, "approved_by", { channel: input.channel, grantId: input.grantId }, "continuity-operational-state", input.now);
  return graph.getObject(grant.id)!;
}

export function acceptSafetyPolicy(graph: EventSourcedGraph, input: ContinuitySafetyPolicyInput): GraphObject {
  const stableKey = `safety_policy:${input.channel}`;
  return upsertGraphObject(
    graph,
    stableKey,
    "policy",
    {
      stableKey,
      policyKind: "safety",
      channel: input.channel,
      active: input.active ?? true,
      policyHash: stableHash(input.policy),
      policy: input.policy
    },
    "continuity-operational-state",
    input.now
  );
}

export function recordSafetyDenial(graph: EventSourcedGraph, input: ContinuitySafetyDenialInput): GraphObject {
  const now = input.now ?? new Date();
  const stableKey = `safety_denial:${input.channel}:${now.toISOString()}:${stableHash(input.command ?? input.reason)}`;
  return upsertGraphObject(
    graph,
    stableKey,
    "safety_denial",
    {
      stableKey,
      channel: input.channel,
      code: input.code,
      reason: input.reason,
      command: input.command,
      commandHash: input.command === undefined ? undefined : stableHash(input.command)
    },
    "continuity-operational-state",
    now
  );
}

export function listActiveCalibrationProfiles(graph: EventSourcedGraph, deviceKey?: string): GraphObject[] {
  return graph
    .findObjects({ type: "calibration_profile" })
    .filter((object) => (object.data.active ?? true) === true)
    .filter((object) => !deviceKey || object.data.deviceKey === deviceKey);
}

export function listActiveSafetyGrants(graph: EventSourcedGraph, channel?: string, now = new Date()): GraphObject[] {
  return graph
    .findObjects({ type: "safety_grant" })
    .filter((object) => !channel || object.data.channel === channel)
    .filter((object) => {
      const expiresAt = object.data.expiresAt;
      return typeof expiresAt !== "string" || Date.parse(expiresAt) >= now.getTime();
    });
}

export function listActiveSafetyPolicies(graph: EventSourcedGraph, channel?: string): GraphObject[] {
  return graph
    .findObjects({ type: "policy" })
    .filter((object) => object.data.policyKind === "safety")
    .filter((object) => (object.data.active ?? true) === true)
    .filter((object) => !channel || object.data.channel === channel);
}

export function listSafetyDenials(graph: EventSourcedGraph, channel?: string): GraphObject[] {
  return graph
    .findObjects({ type: "safety_denial" })
    .filter((object) => !channel || object.data.channel === channel);
}

export function listActiveApprovals(graph: EventSourcedGraph, approvalKind?: string, now = new Date()): GraphObject[] {
  return graph
    .findObjects({ type: "approval" })
    .filter((object) => !approvalKind || object.data.approvalKind === approvalKind)
    .filter((object) => {
      const expiresAt = object.data.expiresAt;
      return typeof expiresAt !== "string" || Date.parse(expiresAt) >= now.getTime();
    });
}

function upsertGraphObject(graph: EventSourcedGraph, stableKey: string, type: string, data: Record<string, unknown>, actor: string, createdAt?: Date): GraphObject {
  const existing = graph.findObjects({ type, where: { stableKey } })[0];
  if (!existing) return graph.addObject(type, data, { actor, createdAt });
  if (stableHash(existing.data) !== stableHash(data)) graph.patchObject(existing.id, data, { actor, createdAt, reason: `Update ${type} ${stableKey}` });
  return graph.getObject(existing.id)!;
}

function ensureRelation(graph: EventSourcedGraph, sourceId: string, targetId: string, type: string, data: Record<string, unknown>, actor: string, createdAt?: Date): void {
  if (!graph.findRelations({ sourceId, targetId, type })[0]) graph.addRelation(sourceId, targetId, type, data, { actor, createdAt });
}
