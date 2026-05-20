import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createId, type AgentSessionEvent, type AgentSessionEventPayload, type AgentSessionId } from "@exocortex/protocol";
import { ContinuityKernel } from "./kernel.js";
import { acceptPatch, ensureMainBranch, proposePatch, rejectPatch } from "./patch.js";
import { InMemoryContinuityStore } from "./in-memory-store.js";
import { SQLiteContinuityStore } from "./sqlite-store.js";
import { createCompletedDependencyBehavior, createContradictionReviewBehavior, createFailureReviewBehavior, createHazardousActionApprovalBehavior, createStaleEvidenceBehavior, createUnsupportedClaimBehavior } from "./behaviors.js";
import { abandonBranch, acceptBranchMerge, archiveBranch, diffBranch, proposeBranchMerge } from "./branching.js";
import { ContinuityCapabilityRegistry } from "./capabilities.js";
import { acceptCalibrationProfile, acceptSafetyGrant, acceptSafetyPolicy, listActiveApprovals, listActiveCalibrationProfiles, listActiveSafetyGrants, listActiveSafetyPolicies } from "./operational-state.js";
import type { ContinuityPatch, ContinuityPatchOp, ContinuityStore } from "./types.js";

const sessionId = createId<"AgentSessionId">("sess");
const created: AgentSessionEvent = baseEvent(sessionId, 1, { type: "session.created", goal: "Build continuity", runtime: { provider: "local", model: "local-rules", driver: "model-driven-agent-runtime" } });
const observation: AgentSessionEvent = baseEvent(sessionId, 2, {
  type: "modality.observation",
  bindingId: createId<"AgentSessionModalityId">("bind"),
  modalityId: createId<"AgentSessionModalityId">("bind"),
  observationType: "text.final",
  value: { text: "battery profile is active" }
});
const failed: AgentSessionEvent = baseEvent(sessionId, 3, {
  type: "tool_call.failed",
  toolCallId: createId<"ToolCallId">("tool"),
  code: "tool_failed",
  message: "command failed"
});

await runStoreContract(new InMemoryContinuityStore());

const tempRoot = mkdtempSync(join(tmpdir(), "exocortex-continuity-"));
try {
  const sqlite = new SQLiteContinuityStore(join(tempRoot, "continuity.db"));
  await runStoreContract(sqlite);
  sqlite.close();
  const reopened = new SQLiteContinuityStore(join(tempRoot, "continuity.db"));
  assert.ok(reopened.findNodeByStableKey("main", `session:${sessionId}`));
  assert.ok(reopened.listNodes("main").some((node) => node.kind === "failure"));
  reopened.close();
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

async function runStoreContract(store: ContinuityStore): Promise<void> {
  ensureMainBranch(store, new Date("2026-05-19T00:00:00.000Z"));
  const kernel = new ContinuityKernel({ store });
  const changes: string[] = [];
  kernel.subscribe((change) => changes.push(change.patchId));

  kernel.appendEvent(created, "main", new Date("2026-05-19T00:00:01.000Z"));
  kernel.appendEvent(observation, "main", new Date("2026-05-19T00:00:02.000Z"));
  kernel.appendEvent(failed, "main", new Date("2026-05-19T00:00:03.000Z"));
  kernel.appendEvent(failed, "main", new Date("2026-05-19T00:00:03.000Z"));

  assert.equal(changes.length, 3);
  assert.ok(store.findNodeByStableKey("main", `session:${sessionId}`));
  assert.ok(store.findNodeByStableKey("main", `goal:${sessionId}:primary`));
  assert.ok(store.listNodes("main").some((node) => node.kind === "agent_version" && node.metadata?.model === "local-rules"));
  assert.ok(store.listNodes("main").some((node) => node.kind === "evidence"));
  assert.ok(store.listNodes("main").some((node) => node.kind === "failure"));
  assert.equal(store.getProjectionOffset("main", "core-event-projector"), 3);

  const branch = kernel.createBranch({ id: "branch_retry", parentBranchId: "main", createdFor: "retry failed command", now: new Date("2026-05-19T00:00:04.000Z") });
  assert.equal(branch.status, "active");

  const patch = manualPatch("branch_retry");
  const op = manualNodeOp(patch);
  proposePatch(store, patch, [op]);
  assert.equal(store.getNode("node_branch_manual"), undefined);
  rejectPatch(store, patch.id, "test", new Date("2026-05-19T00:00:05.000Z"));
  assert.equal(store.getNode("node_branch_manual"), undefined);

  const patch2 = { ...manualPatch("branch_retry"), id: "patch_manual_accepted", createdAt: "2026-05-19T00:00:06.000Z" };
  const op2 = { ...manualNodeOp(patch2), id: "op_manual_accepted" };
  proposePatch(store, patch2, [op2]);
  acceptPatch(store, patch2.id, "test", new Date("2026-05-19T00:00:07.000Z"));
  assert.equal(store.getNode("node_branch_manual")?.kind, "task");
  assert.equal(store.findNodeByStableKey("main", "task:manual"), undefined);
  const diff = diffBranch(store, "branch_retry", "main");
  assert.deepEqual(diff.addedNodes.map((node) => node.stableKey), ["task:manual"]);
  const merge = proposeBranchMerge(store, { branchId: "branch_retry", baseBranchId: "main", now: new Date("2026-05-19T00:00:07.500Z") });
  assert.equal(merge.diff.conflicts.length, 0);
  assert.equal(merge.ops.filter((op) => op.op === "create_node").length, 1);
  acceptBranchMerge(store, merge, "test", new Date("2026-05-19T00:00:07.750Z"));
  assert.equal(store.findNodeByStableKey("main", "task:manual")?.kind, "task");
  assert.equal(store.getBranch("branch_retry")?.status, "merged");
  kernel.createBranch({ id: "branch_scratch", parentBranchId: "main", createdFor: "scratch", now: new Date("2026-05-19T00:00:07.800Z") });
  assert.equal(abandonBranch(store, "branch_scratch").status, "abandoned");
  assert.equal(archiveBranch(store, "branch_scratch").status, "archived");

  const failureChange = {
    branchId: "main",
    patchId: "patch_failure_change",
    nodeIds: store.listNodes("main").filter((node) => node.kind === "failure").map((node) => node.id),
    edgeIds: [],
    changedAt: "2026-05-19T00:00:08.000Z"
  };
  const proposed = await createFailureReviewBehavior().evaluate(failureChange, { store, now: new Date("2026-05-19T00:00:08.000Z") });
  assert.equal(proposed.length, 1);
  proposePatch(store, proposed[0]!.patch, proposed[0]!.ops);
  acceptPatch(store, proposed[0]!.patch.id, "test", new Date("2026-05-19T00:00:09.000Z"));
  assert.ok(store.listNodes("main").some((node) => node.kind === "task" && node.stableKey.startsWith("task:review_failure:")));

  const claimPatch = manualClaimPatch("main");
  proposePatch(store, claimPatch.patch, claimPatch.ops);
  acceptPatch(store, claimPatch.patch.id, "test", new Date("2026-05-19T00:00:10.000Z"));
  const claimChange = { branchId: "main", patchId: claimPatch.patch.id, nodeIds: ["node_claim_manual"], edgeIds: [], changedAt: "2026-05-19T00:00:10.000Z" };
  const claimProposals = await createUnsupportedClaimBehavior().evaluate(claimChange, { store, now: new Date("2026-05-19T00:00:11.000Z") });
  assert.equal(claimProposals.length, 1);

  const contradictionPatch = manualContradictionPatch("main");
  proposePatch(store, contradictionPatch.patch, contradictionPatch.ops);
  acceptPatch(store, contradictionPatch.patch.id, "test", new Date("2026-05-19T00:00:11.250Z"));
  const contradictionProposals = await createContradictionReviewBehavior().evaluate(
    { branchId: "main", patchId: contradictionPatch.patch.id, nodeIds: ["node_claim_contradiction_a"], edgeIds: ["edge_claims_contradict"], changedAt: "2026-05-19T00:00:11.250Z" },
    { store, now: new Date("2026-05-19T00:00:11.250Z") }
  );
  assert.equal(contradictionProposals.length, 1);

  const stalePatch = manualStaleEvidencePatch("main");
  proposePatch(store, stalePatch.patch, stalePatch.ops);
  acceptPatch(store, stalePatch.patch.id, "test", new Date("2026-05-19T00:00:11.500Z"));
  const staleProposals = await createStaleEvidenceBehavior().evaluate(
    { branchId: "main", patchId: stalePatch.patch.id, nodeIds: ["node_evidence_stale"], edgeIds: [], changedAt: "2026-05-19T00:00:11.500Z" },
    { store, now: new Date("2026-05-19T00:00:11.500Z") }
  );
  assert.equal(staleProposals.length, 1);

  const dependencyPatch = manualDependencyPatch("main");
  proposePatch(store, dependencyPatch.patch, dependencyPatch.ops);
  acceptPatch(store, dependencyPatch.patch.id, "test", new Date("2026-05-19T00:00:11.750Z"));
  const dependencyProposals = await createCompletedDependencyBehavior().evaluate(
    { branchId: "main", patchId: dependencyPatch.patch.id, nodeIds: ["node_task_dependency_done"], edgeIds: ["edge_task_depends"], changedAt: "2026-05-19T00:00:11.750Z" },
    { store, now: new Date("2026-05-19T00:00:11.750Z") }
  );
  assert.equal(dependencyProposals.length, 1);
  proposePatch(store, dependencyProposals[0]!.patch, dependencyProposals[0]!.ops);
  acceptPatch(store, dependencyProposals[0]!.patch.id, "test", new Date("2026-05-19T00:00:11.800Z"));
  assert.equal(store.getNode("node_task_blocked")?.metadata?.blocked, false);

  const actionEvent = baseEvent(sessionId, 4, {
    type: "modality.action",
    bindingId: createId<"AgentSessionModalityId">("bind"),
    modalityId: createId<"AgentSessionModalityId">("bind"),
    actionType: "actuator.command",
    value: { enabled: true, duty: 1 }
  });
  kernel.appendEvent(actionEvent, "main", new Date("2026-05-19T00:00:11.900Z"));
  const actionNode = store.findNodeByStableKey("main", `modality_action:${actionEvent.id}`);
  assert.ok(actionNode);
  const hazardousProposals = await createHazardousActionApprovalBehavior().evaluate(
    { branchId: "main", patchId: "patch_action_change", nodeIds: [actionNode.id], edgeIds: [], changedAt: "2026-05-19T00:00:11.900Z" },
    { store, now: new Date("2026-05-19T00:00:11.900Z") }
  );
  assert.equal(hazardousProposals.length, 1);

  const capabilities = new ContinuityCapabilityRegistry(store);
  const registered = capabilities.register({
    branchId: "main",
    kind: "tool",
    key: "browser_navigate",
    provider: "@exocortex/session",
    version: "1",
    definition: { name: "browser_navigate" },
    now: new Date("2026-05-19T00:00:12.000Z")
  });
  assert.equal(registered.node.kind, "capability");
  capabilities.register({
    branchId: "main",
    kind: "tool",
    key: "browser_navigate",
    provider: "@exocortex/session",
    version: "1",
    definition: { name: "browser_navigate" },
    now: new Date("2026-05-19T00:00:12.500Z")
  });
  assert.equal(capabilities.listEnabled("main", "tool").length, 1);
  const hashBeforeDisable = capabilities.capabilitySetHash("main");
  capabilities.setEnabled("main", "tool", "browser_navigate", false, new Date("2026-05-19T00:00:13.000Z"));
  assert.equal(capabilities.listEnabled("main", "tool").length, 0);
  assert.notEqual(capabilities.capabilitySetHash("main"), hashBeforeDisable);

  acceptSafetyPolicy(store, {
    branchId: "main",
    channel: "laser_enable",
    policy: { requiresArm: true, maxDuty: 1 },
    now: new Date("2026-05-19T00:00:13.500Z")
  });
  acceptSafetyPolicy(store, {
    branchId: "main",
    channel: "laser_enable",
    policy: { requiresArm: true, maxDuty: 1 },
    now: new Date("2026-05-19T00:00:13.750Z")
  });
  assert.equal(listActiveSafetyPolicies(store, "main", "laser_enable").length, 1);

  acceptCalibrationProfile(store, {
    branchId: "main",
    profileId: "head_profile_v1",
    deviceKey: "head_serial_bridge",
    profile: { calibrations: [] },
    now: new Date("2026-05-19T00:00:14.000Z")
  });
  acceptCalibrationProfile(store, {
    branchId: "main",
    profileId: "head_profile_v2",
    deviceKey: "head_serial_bridge",
    profile: { calibrations: [{ channel: "battery_voltage" }] },
    supersedesProfileId: "head_profile_v1",
    now: new Date("2026-05-19T00:00:15.000Z")
  });
  assert.equal(listActiveCalibrationProfiles(store, "main", "head_serial_bridge").length, 1);
  assert.equal(store.findNodeByStableKey("main", "calibration_profile:head_serial_bridge:head_profile_v1")?.status, "superseded");
  assert.ok(store.listEdges({ branchId: "main", kind: "supersedes" }).some((edge) => edge.metadata?.deviceKey === "head_serial_bridge"));

  acceptSafetyGrant(store, {
    branchId: "main",
    grantId: "laser_bench",
    channel: "laser_enable",
    approvedBy: "operator",
    reason: "bench alignment",
    hazardous: true,
    expiresAt: "2026-05-19T00:01:00.000Z",
    now: new Date("2026-05-19T00:00:16.000Z")
  });
  assert.equal(listActiveSafetyGrants(store, "main", "laser_enable", new Date("2026-05-19T00:00:30.000Z")).length, 1);
  assert.equal(listActiveApprovals(store, "main", "safety_grant", new Date("2026-05-19T00:00:30.000Z")).length, 1);
  assert.ok(store.listEdges({ branchId: "main", kind: "approved_by" }).some((edge) => edge.metadata?.grantId === "laser_bench"));
  assert.equal(listActiveSafetyGrants(store, "main", "laser_enable", new Date("2026-05-19T00:02:00.000Z")).length, 0);
  assert.equal(listActiveApprovals(store, "main", "safety_grant", new Date("2026-05-19T00:02:00.000Z")).length, 0);
}

function baseEvent(payloadSessionId: AgentSessionId, sequence: number, payload: AgentSessionEventPayloadWithoutBase): AgentSessionEvent {
  return {
    ...payload,
    id: createId("evt"),
    sessionId: payloadSessionId,
    sequence,
    createdAt: "2026-05-19T00:00:00.000Z"
  } as unknown as AgentSessionEvent;
}

type AgentSessionEventPayloadWithoutBase = AgentSessionEventPayload;

function manualPatch(branchId: string): ContinuityPatch {
  return {
    id: "patch_manual",
    branchId,
    status: "proposed",
    riskLevel: "low",
    reason: "manual branch task",
    createdAt: "2026-05-19T00:00:05.000Z"
  };
}

function manualNodeOp(patch: ContinuityPatch): ContinuityPatchOp {
  return {
    id: "op_manual",
    patchId: patch.id,
    op: "create_node",
    createdAt: patch.createdAt,
    payload: {
      id: "node_branch_manual",
      branchId: patch.branchId,
      kind: "task",
      stableKey: "task:manual",
      status: "active",
      createdByPatchId: patch.id,
      createdAt: patch.createdAt,
      metadata: {},
      revision: {
        id: "rev_branch_manual",
        nodeId: "node_branch_manual",
        patchId: patch.id,
        version: 1,
        title: "Manual branch task",
        createdAt: patch.createdAt,
        metadata: {}
      }
    }
  };
}

function manualClaimPatch(branchId: string): { patch: ContinuityPatch; ops: ContinuityPatchOp[] } {
  const patch: ContinuityPatch = {
    id: "patch_claim_manual",
    branchId,
    status: "proposed",
    riskLevel: "medium",
    reason: "manual unsupported claim",
    createdAt: "2026-05-19T00:00:10.000Z"
  };
  return {
    patch,
    ops: [
      {
        id: "op_claim_manual",
        patchId: patch.id,
        op: "create_node",
        createdAt: patch.createdAt,
        payload: {
          id: "node_claim_manual",
          branchId,
          kind: "claim",
          stableKey: "claim:manual",
          status: "active",
          createdByPatchId: patch.id,
          createdAt: patch.createdAt,
          metadata: {},
          revision: {
            id: "rev_claim_manual",
            nodeId: "node_claim_manual",
            patchId: patch.id,
            version: 1,
            title: "Manual claim",
            createdAt: patch.createdAt,
            metadata: {}
          }
        }
      }
    ]
  };
}

function manualContradictionPatch(branchId: string): { patch: ContinuityPatch; ops: ContinuityPatchOp[] } {
  const patch: ContinuityPatch = {
    id: "patch_claim_contradiction",
    branchId,
    status: "proposed",
    riskLevel: "medium",
    reason: "manual contradictory claims",
    createdAt: "2026-05-19T00:00:11.250Z"
  };
  return {
    patch,
    ops: [
      nodeOp(patch, "node_claim_contradiction_a", "claim", "claim:contradiction:a", "Claim A", {}),
      nodeOp(patch, "node_claim_contradiction_b", "claim", "claim:contradiction:b", "Claim B", {}),
      {
        id: "op_claims_contradict",
        patchId: patch.id,
        op: "create_edge",
        createdAt: patch.createdAt,
        payload: {
          id: "edge_claims_contradict",
          branchId,
          fromNodeId: "node_claim_contradiction_a",
          toNodeId: "node_claim_contradiction_b",
          kind: "contradicts",
          status: "active",
          createdByPatchId: patch.id,
          createdAt: patch.createdAt,
          metadata: {}
        }
      }
    ]
  };
}

function manualStaleEvidencePatch(branchId: string): { patch: ContinuityPatch; ops: ContinuityPatchOp[] } {
  const patch: ContinuityPatch = {
    id: "patch_stale_evidence",
    branchId,
    status: "proposed",
    riskLevel: "low",
    reason: "manual stale evidence",
    createdAt: "2026-05-19T00:00:11.500Z"
  };
  return { patch, ops: [nodeOp(patch, "node_evidence_stale", "evidence", "evidence:stale", "Stale evidence", { stale: true })] };
}

function manualDependencyPatch(branchId: string): { patch: ContinuityPatch; ops: ContinuityPatchOp[] } {
  const patch: ContinuityPatch = {
    id: "patch_completed_dependency",
    branchId,
    status: "proposed",
    riskLevel: "low",
    reason: "manual completed dependency",
    createdAt: "2026-05-19T00:00:11.750Z"
  };
  return {
    patch,
    ops: [
      nodeOp(patch, "node_task_dependency_done", "task", "task:dependency_done", "Dependency done", { state: "completed" }),
      nodeOp(patch, "node_task_blocked", "task", "task:blocked", "Blocked task", { state: "open", blocked: true }),
      {
        id: "op_task_depends",
        patchId: patch.id,
        op: "create_edge",
        createdAt: patch.createdAt,
        payload: {
          id: "edge_task_depends",
          branchId,
          fromNodeId: "node_task_blocked",
          toNodeId: "node_task_dependency_done",
          kind: "depends_on",
          status: "active",
          createdByPatchId: patch.id,
          createdAt: patch.createdAt,
          metadata: {}
        }
      }
    ]
  };
}

function nodeOp(patch: ContinuityPatch, id: string, kind: string, stableKey: string, title: string, metadata: Record<string, unknown>): ContinuityPatchOp {
  return {
    id: `op_${id}`,
    patchId: patch.id,
    op: "create_node",
    createdAt: patch.createdAt,
    payload: {
      id,
      branchId: patch.branchId,
      kind,
      stableKey,
      status: "active",
      createdByPatchId: patch.id,
      createdAt: patch.createdAt,
      metadata,
      revision: {
        id: `rev_${id}`,
        nodeId: id,
        patchId: patch.id,
        version: 1,
        title,
        createdAt: patch.createdAt,
        metadata
      }
    }
  };
}
